import proj4 from 'proj4';

function _getTileLayerFromTarget(target, layerId = 'cog-layer') {
  const deckInstance = this._resolveDeckInstance(target);
  if (!deckInstance || !deckInstance.layerManager || typeof deckInstance.layerManager.getLayers !== 'function') {
    return null;
  }

  const renderedLayers = deckInstance.layerManager.getLayers({ layerIds: [layerId] }) || [];
  const tileLayerId = `${layerId}-tile-layer`;

  let tileLayer = renderedLayers.find((candidate) => candidate && candidate.id === tileLayerId);
  if (tileLayer) {
    return tileLayer;
  }

  const cogLayer = renderedLayers.find((candidate) => candidate && candidate.id === layerId);
  if (cogLayer && cogLayer.state && cogLayer.state.tileset) {
    return cogLayer;
  }

  for (const layer of renderedLayers) {
    if (!layer || typeof layer.getSubLayers !== 'function') {
      continue;
    }
    const subLayers = layer.getSubLayers();
    tileLayer = subLayers.find((sl) => sl && sl.state && sl.state.tileset);
    if (tileLayer) {
      return tileLayer;
    }
  }

  return null;
}

function _normalizeLngLat(lngLat) {
  if (Array.isArray(lngLat) && lngLat.length >= 2) {
    const lng = Number(lngLat[0]);
    const lat = Number(lngLat[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return [lng, lat];
    }
    return null;
  }

  if (lngLat && typeof lngLat === 'object') {
    const lng = Number(lngLat.lng);
    const lat = Number(lngLat.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return [lng, lat];
    }
  }

  return null;
}

function _normalizeBounds(bounds) {
  if (!bounds) {
    return null;
  }

  if (
    typeof bounds === 'object' &&
    !Array.isArray(bounds) &&
    bounds.topLeft &&
    bounds.topRight &&
    bounds.bottomLeft &&
    bounds.bottomRight
  ) {
    const corners = [bounds.topLeft, bounds.topRight, bounds.bottomLeft, bounds.bottomRight];
    const lngs = corners.map((c) => (Array.isArray(c) ? Number(c[0]) : null)).filter((x) => Number.isFinite(x));
    const lats = corners.map((c) => (Array.isArray(c) ? Number(c[1]) : null)).filter((x) => Number.isFinite(x));

    if (lngs.length === 4 && lats.length === 4) {
      const west = Math.min(...lngs);
      const east = Math.max(...lngs);
      const south = Math.min(...lats);
      const north = Math.max(...lats);
      return [west, south, east, north];
    }
    return null;
  }

  if (
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1])
  ) {
    const west = Number(bounds[0][0]);
    const south = Number(bounds[0][1]);
    const east = Number(bounds[1][0]);
    const north = Number(bounds[1][1]);
    if (Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)) {
      return [west, south, east, north];
    }
    return null;
  }

  if (Array.isArray(bounds) && bounds.length >= 4) {
    const west = Number(bounds[0]);
    const south = Number(bounds[1]);
    const east = Number(bounds[2]);
    const north = Number(bounds[3]);
    if (Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)) {
      return [west, south, east, north];
    }
    return null;
  }

  if (typeof bounds === 'object') {
    const west = Number(bounds.west ?? bounds.left ?? bounds.minX ?? bounds[0]);
    const south = Number(bounds.south ?? bounds.bottom ?? bounds.minY ?? bounds[1]);
    const east = Number(bounds.east ?? bounds.right ?? bounds.maxX ?? bounds[2]);
    const north = Number(bounds.north ?? bounds.top ?? bounds.maxY ?? bounds[3]);
    if (Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)) {
      return [west, south, east, north];
    }
  }

  return null;
}

function _extractTilePayload(tile) {
  if (!tile || typeof tile !== 'object') {
    return null;
  }

  const candidates = [
    tile.content && tile.content.data,
    tile.content,
    tile.data && tile.data.data,
    tile.data
  ];

  for (const candidate of candidates) {
    const payload = candidate && candidate.data ? candidate.data : candidate;
    if (
      payload &&
      payload.data &&
      Number.isFinite(Number(payload.width)) &&
      Number.isFinite(Number(payload.height)) &&
      Number.isFinite(Number(payload.bandCount))
    ) {
      return payload;
    }
  }

  return null;
}

function _extractTileBounds(tile) {
  if (!tile || typeof tile !== 'object') {
    return null;
  }

  const candidates = [
    tile.projectedBounds,
    tile.bounds,
    tile.bbox,
    tile.boundingBox,
    tile.tileBounds,
    tile.content && tile.content.bounds,
    tile.content && tile.content.bbox,
    tile.content && tile.content.tileBounds
  ];

  for (const candidate of candidates) {
    const normalized = this._normalizeBounds(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function _extractProjectionCodeFromTile(tile, payload) {
  const candidates = [
    tile && tile.content && tile.content.geoKeys,
    tile && tile.content && tile.content.data && tile.content.data.geoKeys,
    tile && tile.data && tile.data.geoKeys,
    tile && tile.data && tile.data.data && tile.data.data.geoKeys,
    payload && payload.geoKeys
  ];

  for (const keys of candidates) {
    if (!keys || typeof keys !== 'object') {
      continue;
    }
    const code = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey);
    if (Number.isFinite(code) && code > 0) {
      return code;
    }
  }

  return null;
}

function _transformLngLatToCrs(lng, lat, crs) {
  try {
    const [x, y] = proj4('EPSG:4326', crs, [lng, lat]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  } catch {
    // Ignore unsupported CRS definitions and continue with next candidate.
  }
  return null;
}

function _buildProjectionCandidates(lng, lat, projectionCode) {
  const candidates = [];
  const add = (crs) => {
    if (!crs || candidates.includes(crs)) {
      return;
    }
    candidates.push(crs);
  };

  if (projectionCode) {
    add(`EPSG:${projectionCode}`);
  }

  add('EPSG:3857');

  const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  const isNorth = lat >= 0;
  add(`EPSG:${isNorth ? 32600 + zone : 32700 + zone}`);
  if (zone > 1) {
    add(`EPSG:${isNorth ? 32600 + (zone - 1) : 32700 + (zone - 1)}`);
  }
  if (zone < 60) {
    add(`EPSG:${isNorth ? 32600 + (zone + 1) : 32700 + (zone + 1)}`);
  }

  return candidates;
}

function _evaluateStyleAtBands(style, bands) {
  if (!style || typeof style.fn !== 'function' || !Array.isArray(bands)) {
    return null;
  }

  const styleInput = bands.map((value) => [[value]]);
  try {
    return style.fn.call({ thread: { x: 0, y: 0 } }, styleInput);
  } catch (error) {
    if (this.debug) {
      console.warn(`[Multiband] getPixelValues: style evaluation failed for "${style.name}"`, error);
    }
    return null;
  }
}

function _isBoundsProjected(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2) {
    return false;
  }
  const firstValue = Math.abs(bounds[0]);
  const secondValue = Math.abs(bounds[1]);
  return firstValue > 360 || secondValue > 360;
}

function getPixelValues(lngLat, target, layerId = 'cog-layer') {
  const normalized = this._normalizeLngLat(lngLat);
  if (!normalized) {
    console.error('[Multiband] getPixelValues: invalid lngLat input (expected [lng,lat] or {lng,lat})');
    return null;
  }

  const tileLayer = this._getTileLayerFromTarget(target, layerId);
  if (!tileLayer || !tileLayer.state || !tileLayer.state.tileset || !Array.isArray(tileLayer.state.tileset.tiles)) {
    if (this.debug) {
      console.warn('[Multiband] getPixelValues: tileset not found for target/layer');
    }
    return null;
  }

  const [lng, lat] = normalized;
  const tileset = tileLayer.state.tileset;
  const tiles = [
    ...(Array.isArray(tileset.selectedTiles) ? tileset.selectedTiles : []),
    ...(Array.isArray(tileset.tiles) ? tileset.tiles : [])
  ];

  const tileEntries = [];
  let boundsMinX = Infinity;
  let boundsMaxX = -Infinity;
  let boundsMinY = Infinity;
  let boundsMaxY = -Infinity;
  let projectionCode = null;

  for (const tile of tiles) {
    if (!tile) {
      continue;
    }

    const bounds = this._extractTileBounds(tile);
    if (!bounds) {
      continue;
    }

    const payload = this._extractTilePayload(tile);
    if (!projectionCode) {
      projectionCode = this._extractProjectionCodeFromTile(tile, payload);
    }

    const [west, south, east, north] = bounds;
    boundsMinX = Math.min(boundsMinX, west);
    boundsMaxX = Math.max(boundsMaxX, east);
    boundsMinY = Math.min(boundsMinY, south);
    boundsMaxY = Math.max(boundsMaxY, north);

    tileEntries.push({ tile, bounds, payload });
  }

  if (tileEntries.length === 0) {
    if (this.debug) {
      console.warn('[Multiband] getPixelValues: no tiles with usable bounds in tileset');
    }
    return null;
  }

  const projectedBounds = this._isBoundsProjected([boundsMinX, boundsMinY, boundsMaxX, boundsMaxY]);
  let clickX = lng;
  let clickY = lat;
  let resolvedCrs = 'EPSG:4326';

  if (projectedBounds) {
    const candidates = this._buildProjectionCandidates(lng, lat, projectionCode);
    let projectedClick = null;

    for (const candidate of candidates) {
      const transformed = this._transformLngLatToCrs(lng, lat, candidate);
      if (!transformed) {
        continue;
      }

      const [x, y] = transformed;
      if (x >= boundsMinX && x <= boundsMaxX && y >= boundsMinY && y <= boundsMaxY) {
        projectedClick = transformed;
        resolvedCrs = candidate;
        break;
      }
    }

    if (projectedClick) {
      [clickX, clickY] = projectedClick;
    } else if (this.debug) {
      console.warn('[Multiband] getPixelValues: could not resolve click CRS against tile bounds envelope');
    }
  }

  let best = null;
  let bestArea = Infinity;

  for (const entry of tileEntries) {
    const { tile, bounds, payload } = entry;
    const [west, south, east, north] = bounds;

    if (clickX < west || clickX > east || clickY < south || clickY > north) {
      continue;
    }

    if (!payload || !payload.data || !payload.width || !payload.height || !payload.bandCount) {
      continue;
    }

    const width = Number(payload.width);
    const height = Number(payload.height);
    const bandCount = Number(payload.bandCount);
    const values = payload.data;
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(bandCount) || width <= 0 || height <= 0 || bandCount <= 0) {
      continue;
    }

    const dx = east - west;
    const dy = north - south;
    if (dx <= 0 || dy <= 0) {
      continue;
    }

    const area = dx * dy;
    if (area >= bestArea) {
      continue;
    }

    const u = (clickX - west) / dx;
    const v = (north - clickY) / dy;
    const px = Math.max(0, Math.min(width - 1, Math.floor(u * width)));
    const py = Math.max(0, Math.min(height - 1, Math.floor(v * height)));

    best = {
      tile,
      bounds,
      width,
      height,
      bandCount,
      values,
      px,
      py
    };
    bestArea = area;
  }

  if (!best) {
    if (this.debug) {
      console.warn(
        `[Multiband] getPixelValues: no loaded tile found at clicked location (crs=${resolvedCrs}, click=[${clickX.toFixed(2)}, ${clickY.toFixed(2)}])`
      );
    }
    return null;
  }

  const { width, height, bandCount, values, px, py } = best;
  const planeSize = width * height;
  const pixelIndex = py * width + px;
  const bands = new Array(bandCount);

  for (let b = 0; b < bandCount; b++) {
    bands[b] = values[b * planeSize + pixelIndex];
  }

  const selectedStyle = this._styles.find((s) => s && s.name === this._activeStyleName) || null;
  const isType2 = Boolean(selectedStyle && Array.isArray(selectedStyle.colors) && Array.isArray(selectedStyle.stops));
  const styleOutput = this._evaluateStyleAtBands(selectedStyle, bands);

  let value = null;
  if (isType2) {
    value = Array.isArray(styleOutput) ? styleOutput[0] : styleOutput;
  } else {
    value = styleOutput;
  }

  return {
    latlng: { lat, lng },
    selectedstyle: selectedStyle ? selectedStyle.name : this._activeStyleName,
    value,
    bands
  };
}

export {
  getPixelValues,
  _getTileLayerFromTarget,
  _normalizeLngLat,
  _normalizeBounds,
  _extractTilePayload,
  _extractTileBounds,
  _extractProjectionCodeFromTile,
  _transformLngLatToCrs,
  _buildProjectionCandidates,
  _evaluateStyleAtBands,
  _isBoundsProjected
};