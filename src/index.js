import { GPU } from 'gpu.js';
import proj4 from 'proj4';
import { geoKeysParser } from './geoKeysParser.js';
import { getTileData } from './getTileData.js';
import { renderTile } from './renderTile.js';

// Convert hex to normalized RGBA [0,1]
const hexToRGBA = (hex) => {
  const hexClean = hex.replace('#', '');
  const r = parseInt(hexClean.substring(0, 2), 16) / 255;
  const g = parseInt(hexClean.substring(2, 4), 16) / 255;
  const b = parseInt(hexClean.substring(4, 6), 16) / 255;
  const a = hexClean.length === 8 ? parseInt(hexClean.substring(6, 8), 16) / 255 : 1.0;
  return [r, g, b, a];
};

// GPU-accelerated multiband raster rendering for deck.gl-raster
class Multiband {
  constructor(options = {}) {
    this.debug = options.debug || false;

    this._gpu = null;
    this._gpuContext = null;
    this._coloringKernel = null;

    this._styles = [];
    this.addStyle('Band 1 - grayscale', function(data) {
      const value = data[0][this.thread.y][this.thread.x];
      const normalized = Math.max(0, Math.min(1, value * 0.00003051757));
      const a = value === 0 ? 0.0 : 1.0;
      return [normalized, normalized, normalized, a];
    });

    this._activeStyleName = 'Band 1 - grayscale';
    this._activeStyleKernel = this._styles[0] ? this._styles[0].kernel : null;
    this._cachedStyleNames = null;
    this._stylesCacheInvalid = true;

    if (this.debug) {
      console.log('[Multiband] Initialized with default style:', this._activeStyleName);
    }

    this.geoKeysParser = geoKeysParser;
    this.getTileData = this._createGetTileDataHandler();
    this.renderTile = this._createRenderTileHandler();
  }


  addStyle(name, fn, options = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      console.error('[Multiband] addStyle: name must be a non-empty string');
      return;
    }

    if (typeof fn !== 'function') {
      console.error('[Multiband] addStyle: fn must be a function');
      return;
    }

    let colors = null;
    let stops = null;
    let rgbaColors = null;
    let domain = null;

    if (typeof options.domain !== 'undefined') {
      if (!Array.isArray(options.domain) || options.domain.length !== 2) {
        console.error('[Multiband] addStyle: domain must be a 2-element array [min, max]');
        return;
      }

      const domainMin = Number(options.domain[0]);
      const domainMax = Number(options.domain[1]);
      if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) {
        console.error('[Multiband] addStyle: domain values must be finite and satisfy max > min');
        return;
      }

      domain = [domainMin, domainMax];
    }

    if (options.colors && options.stops) {
      if (!Array.isArray(options.colors) || !Array.isArray(options.stops)) {
        console.error('[Multiband] addStyle: colors and stops must be arrays');
        return;
      }

      if (options.colors.length !== options.stops.length) {
        console.error('[Multiband] addStyle: colors and stops arrays must have the same length');
        return;
      }

      if (options.colors.length < 2) {
        console.error('[Multiband] addStyle: colors and stops arrays must have at least 2 elements');
        return;
      }

      colors = options.colors;
      stops = options.stops;

      try {
        rgbaColors = colors.map(hexToRGBA);
      } catch (error) {
        console.error(`[Multiband] addStyle: failed to convert hex colors for style "${name}"`, error);
        return;
      }
    } else if (domain) {
      console.error('[Multiband] addStyle: domain can only be used with gradient styles (requires colors and stops)');
      return;
    }

    let kernel = null;
    try {
      kernel = this._compileStyleKernel(fn);
    } catch (error) {
      console.error(`[Multiband] addStyle: failed to compile kernel for style "${name}"`, error);
      return;
    }

    const existingIndex = this._styles.findIndex(s => s.name === name);
    if (existingIndex >= 0) {
      const previousKernel = this._styles[existingIndex].kernel;
      if (previousKernel && typeof previousKernel.destroy === 'function') {
        previousKernel.destroy();
      }
      this._styles[existingIndex] = {
        name,
        fn,
        kernel,
        colors,
        stops,
        domain,
        rgbaColors,
        colorLUT: null
      };
      if (name === this._activeStyleName) {
        this._activeStyleKernel = kernel;
      }
      if (this.debug) {
        console.log(`[Multiband] Updated existing style: ${name}`);
      }
    } else {
      this._styles.push({
        name,
        fn,
        kernel,
        colors,
        stops,
        domain,
        rgbaColors,
        colorLUT: null
      });
      this._stylesCacheInvalid = true;
      if (name === this._activeStyleName) {
        this._activeStyleKernel = kernel;
      }
      if (this.debug) {
        console.log(`[Multiband] Added new style: ${name}`);
      }
    }
  }

  /**
   * Remove a style from the styles collection
   * @param {string} name - Style name to remove
   */
  removeStyle(name) {
    if (name === 'Band 1 - grayscale') {
      if (this.debug) {
        console.warn('[Multiband] Cannot remove default style "Band 1 - grayscale"');
      }
      return;
    }

    const index = this._styles.findIndex(s => s.name === name);
    if (index >= 0) {
      const styleToRemove = this._styles[index];
      if (styleToRemove && styleToRemove.kernel && typeof styleToRemove.kernel.destroy === 'function') {
        styleToRemove.kernel.destroy();
      }
      this._styles.splice(index, 1);
      this._stylesCacheInvalid = true;

      // If the active style was removed, reset to default
      if (this._activeStyleName === name) {
        this._activeStyleName = 'Band 1 - grayscale';
        const defaultStyle = this._styles.find(s => s.name === 'Band 1 - grayscale');
        this._activeStyleKernel = defaultStyle ? defaultStyle.kernel : null;
        if (this.debug) {
          console.log(`[Multiband] Active style was removed, reset to: ${this._activeStyleName}`);
        }
      }

      if (this.debug) {
        console.log(`[Multiband] Removed style: ${name}`);
      }
    } else if (this.debug) {
      console.log(`[Multiband] Style not found: ${name}`);
    }
  }

  /**
   * Set the active style
   * @param {string} name - Style name to activate
   * @param {Object} [target] - Optional deck.gl instance or map-like object with __deck
   * @param {string} [layerId='cog-layer'] - Optional COGLayer id to refresh immediately
   */
  setActiveStyle(name, target, layerId = 'cog-layer') {
    const style = this._styles.find(s => s.name === name);

    if (!style) {
      console.error(`[Multiband] Style not found: ${name}, defaulting to "Band 1 - grayscale"`);
      this._activeStyleName = 'Band 1 - grayscale';
      const defaultStyle = this._styles.find(s => s.name === 'Band 1 - grayscale');
      this._activeStyleKernel = this._ensureStyleKernel(defaultStyle);
    } else {
      const previousStyle = this._activeStyleName;
      this._activeStyleName = name;
      this._activeStyleKernel = this._ensureStyleKernel(style);
      if (this.debug) {
        console.log(`[Multiband] Active style changed: "${previousStyle}" → "${name}"`);
      }
    }

    if (target) {
      this._refreshTiles(target, layerId);
    }
  }

  /**
   * Get the name of the currently active style
   * @returns {string} Active style name
   */
  getActiveStyle() {
    return this._activeStyleName;
  }

  /**
   * Get an array of all available style names
   * @returns {string[]} Array of style names
   */
  getStyles() {
    if (!this._cachedStyleNames || this._stylesCacheInvalid) {
      this._cachedStyleNames = this._styles.map(s => s.name);
      this._stylesCacheInvalid = false;
    }
    return this._cachedStyleNames;
  }

  /**
   * Refresh rendered tiles after style change
   * Invalidates cached tile sublayers to force re-rendering with active style
   * @param {Object} target - deck.gl instance or map-like object with __deck
   * @param {string} layerId - The COGLayer id (default: 'cog-layer')
   * @private
   */
  _refreshTiles(target, layerId = 'cog-layer') {
    if (this.debug) {
      console.log(`[Multiband] refreshTiles called for layer: ${layerId}, active style: ${this._activeStyleName}`);
    }

    const deckInstance = this._resolveDeckInstance(target);
    const requestRepaint = () => {
      if (target && typeof target.triggerRepaint === 'function') {
        target.triggerRepaint();
      } else if (deckInstance && typeof deckInstance.redraw === 'function') {
        deckInstance.redraw();
      }
    };

    if (!deckInstance) {
      if (this.debug) {
        console.warn('[Multiband] refreshTiles: deck instance not found (expected deck instance or map.__deck)');
      }
      requestRepaint();
      return;
    }

    const layerManager = deckInstance.layerManager;

    if (!layerManager || typeof layerManager.getLayers !== 'function') {
      if (this.debug) {
        console.warn('[Multiband] refreshTiles: layerManager not available');
      }
      requestRepaint();
      return;
    }

    const renderedLayers = layerManager.getLayers({ layerIds: [layerId] }) || [];
    let tileLayer = null;

    const tileLayerId = `${layerId}-tile-layer`;
    tileLayer = renderedLayers.find((candidate) => candidate && candidate.id === tileLayerId);

    if (!tileLayer) {
      const cogLayer = renderedLayers.find((candidate) => candidate && candidate.id === layerId);
      if (cogLayer && cogLayer.state && cogLayer.state.tileset) {
        tileLayer = cogLayer;
      }
    }

    if (!tileLayer) {
      for (const layer of renderedLayers) {
        if (layer.getSubLayers) {
          const subLayers = layer.getSubLayers();
          tileLayer = subLayers.find(sl => sl.state && sl.state.tileset);
          if (tileLayer) {
            break;
          }
        }
      }
    }

    const tileset = tileLayer && tileLayer.state && tileLayer.state.tileset;

    if (!tileset || !Array.isArray(tileset.tiles)) {
      if (this.debug) {
        console.warn('[Multiband] refreshTiles: tileset not found or has no tiles');
      }
      requestRepaint();
      return;
    }

    // Drop cached sublayers so each visible tile is rendered again with the active style.
    let tilesCleared = 0;
    tileset.tiles.forEach((tile) => {
      if (tile.layers !== null) {
        tile.layers = null;
        tilesCleared++;
      }
    });

    if (typeof tileLayer.setNeedsUpdate === 'function') {
      tileLayer.setNeedsUpdate();
    }

    if (typeof layerManager.setNeedsUpdate === 'function') {
      layerManager.setNeedsUpdate('style changed');
    }
    if (typeof layerManager.setNeedsRedraw === 'function') {
      layerManager.setNeedsRedraw('style changed');
    }

    requestRepaint();

    if (this.debug) {
      console.log(`[Multiband] refreshTiles complete: cleared ${tilesCleared} tile sublayers, triggered redraw`);
    }
  }

  /**
   * Resolve deck instance from supported refreshTiles targets
   * @param {Object} target - deck instance or map-like wrapper
   * @returns {Object|null} deck instance or null when not found
   * @private
   */
  _resolveDeckInstance(target) {
    if (!target || typeof target !== 'object') {
      return null;
    }

    if (target.layerManager && typeof target.redraw === 'function') {
      return target;
    }

    if (target.__deck && typeof target.__deck === 'object') {
      return target.__deck;
    }

    return null;
  }

  /**
   * Locate the underlying tile layer used by a COGLayer id.
   * @param {Object} target - deck instance or map-like wrapper
   * @param {string} layerId - COGLayer id
   * @returns {Object|null} tile layer or null
   * @private
   */
  _getTileLayerFromTarget(target, layerId = 'cog-layer') {
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

  /**
   * Normalize a lng/lat input into [lng, lat].
   * @param {Array<number>|Object} lngLat
   * @returns {number[]|null}
   * @private
   */
  _normalizeLngLat(lngLat) {
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

  /**
   * Normalize tile bounds to [west, south, east, north].
   * @param {Object|Array<number>} bounds
   * @returns {number[]|null}
   * @private
   */
  _normalizeBounds(bounds) {
    if (!bounds) {
      return null;
    }

    // Handle corner-based format: {topLeft, topRight, bottomLeft, bottomRight}
    // Each corner is [x, y] in the same CRS as the tile bounds.
    if (
      typeof bounds === 'object' &&
      !Array.isArray(bounds) &&
      bounds.topLeft &&
      bounds.topRight &&
      bounds.bottomLeft &&
      bounds.bottomRight
    ) {
      const corners = [bounds.topLeft, bounds.topRight, bounds.bottomLeft, bounds.bottomRight];
      const lngs = corners.map(c => Array.isArray(c) ? Number(c[0]) : null).filter(x => Number.isFinite(x));
      const lats = corners.map(c => Array.isArray(c) ? Number(c[1]) : null).filter(x => Number.isFinite(x));
      
      if (lngs.length === 4 && lats.length === 4) {
        const west = Math.min(...lngs);
        const east = Math.max(...lngs);
        const south = Math.min(...lats);
        const north = Math.max(...lats);
        return [west, south, east, north];
      }
      return null;
    }

    // Handle [[west, south], [east, north]] format
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

    // Handle [west, south, east, north] format
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

    // Handle object formats: {west, south, east, north} or {left, right, top, bottom} or {minX, minY, maxX, maxY}
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

  /**
   * Extract raster payload from deck.gl tile internals.
   * Supports COGLayer wrappers where payload is under tile.content.data.
   * @param {Object} tile
   * @returns {Object|null}
   * @private
   */
  _extractTilePayload(tile) {
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

  /**
   * Extract geographic tile bounds from deck.gl tile internals.
   * @param {Object} tile
   * @returns {number[]|null}
   * @private
   */
  _extractTileBounds(tile) {
    if (!tile || typeof tile !== 'object') {
      return null;
    }

    const candidates = [
      tile.projectedBounds,  // Try corner-based bounds first (actual visual bounds)
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

  _extractProjectionCodeFromTile(tile, payload) {
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

  _transformLngLatToCrs(lng, lat, crs) {
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

  _buildProjectionCandidates(lng, lat, projectionCode) {
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

    // Common fallback for deck map coordinates.
    add('EPSG:3857');

    // UTM fallback based on click longitude.
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

  _evaluateStyleAtBands(style, bands) {
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

  /**
   * Detect if bounds are in projected coordinates (millions-scale) vs geographic (degrees).
   * @param {number[]} bounds - [west, south, east, north]
   * @returns {boolean} true if appears to be projected
   * @private
   */
  _isBoundsProjected(bounds) {
    if (!Array.isArray(bounds) || bounds.length < 2) {
      return false;
    }
    const firstValue = Math.abs(bounds[0]);
    const secondValue = Math.abs(bounds[1]);
    return firstValue > 360 || secondValue > 360;
  }

  /**
   * Read cached band values for a click position from loaded tiles.
   * @param {Array<number>|Object} lngLat - [lng, lat] or {lng, lat}
   * @param {Object} target - deck instance or map-like object exposing __deck
   * @param {string} [layerId='cog-layer'] - COGLayer id
   * @returns {Object|null} Per-band values and pixel/tile metadata, or null if not found
   */
  getPixelValues(lngLat, target, layerId = 'cog-layer') {
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

    const { tile, width, height, bandCount, values, px, py } = best;
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
      // Type 2 sampling returns the scalar produced by fn (no colorization applied).
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

  /**
   * Extract WebGL context from luma device.
   * @param {Object} device - luma device
   * @returns {WebGL2RenderingContext|WebGLRenderingContext}
   * @private
   */
  _extractWebGLContext(device) {
    if (!device || typeof device !== 'object') {
      throw new Error('[Multiband] Missing luma device in getTileData options');
    }

    if (device.gl && typeof device.gl.bindTexture === 'function') {
      return device.gl;
    }

    if (device.handle && typeof device.handle.bindTexture === 'function') {
      return device.handle;
    }

    throw new Error('[Multiband] Unable to extract WebGL context from luma device');
  }

  /**
   * Compile a style kernel for the current GPU.js context.
   * @param {Function} fn - Style function
   * @returns {Function|null} Compiled kernel
   * @private
   */
  _compileStyleKernel(fn) {
    if (!this._gpu) {
      return null;
    }

    return this._gpu.createKernel(fn, {
      dynamicOutput: true,
      dynamicArguments: true,
      graphical: false,
      pipeline: true,
      immutable: true
    });
  }

  /**
   * Compile the coloring kernel for gradient mapping
   * @returns {Function|null} Compiled coloring kernel
   * @private
   */
  _compileColoringKernel() {
    if (!this._gpu) {
      return null;
    }

    // GPU.js-safe kernel: direct color lookup from a CPU-generated LUT.
    // Keep this branch-free to avoid GPU.js generating invalid GLSL boolean ops.
    const coloringFn = function(scalarTexture, colorLUT, domainMin, domainMax) {
      const pixel = scalarTexture[this.thread.y][this.thread.x];
      const scalarVal = pixel[0];
      const sourceAlpha = pixel[3];

      const domainRange = Math.max(0.0000001, domainMax - domainMin);
      const normalized = (scalarVal - domainMin) / domainRange;
      const idx = Math.floor(Math.min(255.0, Math.max(0.0, normalized * 255.0)));

      const r = colorLUT[idx][0];
      const g = colorLUT[idx][1];
      const b = colorLUT[idx][2];
      const a = colorLUT[idx][3];

      const finalAlpha = a * sourceAlpha;
      return [r, g, b, finalAlpha];
    };

    return this._gpu.createKernel(coloringFn, {
      dynamicOutput: true,
      dynamicArguments: true,
      graphical: false,
      pipeline: true,
      immutable: true
    });
  }

  /**
   * Compile and cache style kernel only when needed.
   * @param {Object|null} style
   * @returns {Function|null}
   * @private
   */
  _ensureStyleKernel(style) {
    if (!style) {
      return null;
    }

    if (!style.kernel) {
      style.kernel = this._compileStyleKernel(style.fn);
    }

    return style.kernel;
  }

  /**
   * Ensure GPU.js is initialized on deck/luma's active WebGL context.
   * @param {Object} device - luma device
   * @private
   */
  _ensureGpuFromDevice(device) {
    const gl = this._extractWebGLContext(device);
    if (this._gpu && this._gpuContext === gl) {
      return;
    }

    const styleDefs = this._styles.map((style) => ({
      name: style.name,
      fn: style.fn,
      colors: style.colors,
      stops: style.stops,
      domain: style.domain,
      rgbaColors: style.rgbaColors
    }));

    this._styles.forEach((style) => {
      if (style && style.kernel && typeof style.kernel.destroy === 'function') {
        style.kernel.destroy();
      }
    });

    if (this._gpu) {
      this._gpu.destroy();
    }

    this._gpu = new GPU({ context: gl, mode: 'webgl2' });
    this._gpuContext = gl;

    // Compile the coloring kernel for gradient mapping
    this._coloringKernel = this._compileColoringKernel();

    this._styles = styleDefs.map(({ name, fn, colors, stops, domain, rgbaColors }) => ({
      name,
      fn,
      kernel: null,
      colors,
      stops,
      domain,
      rgbaColors,
      colorLUT: null
    }));

    const activeStyle = this._styles.find(s => s.name === this._activeStyleName)
      || this._styles.find(s => s.name === 'Band 1 - grayscale')
      || null;

    this._activeStyleName = activeStyle ? activeStyle.name : 'Band 1 - grayscale';
    this._activeStyleKernel = this._ensureStyleKernel(activeStyle);
  }

  /**
   * Get the precompiled GPU.js kernel for the active style
   * @returns {Function} GPU.js kernel
   */
  _getActiveStyleKernel() {
    if (this._activeStyleKernel) {
      return this._activeStyleKernel;
    }

    const style = this._styles.find(s => s.name === this._activeStyleName);

    if (!style) {
      // Fallback to default
      if (this.debug) {
        console.warn(`[Multiband] Style "${this._activeStyleName}" not found, falling back to default`);
      }
      const defaultStyle = this._styles.find(s => s.name === 'Band 1 - grayscale');
      this._activeStyleKernel = this._ensureStyleKernel(defaultStyle);
      return this._activeStyleKernel;
    }
    this._activeStyleKernel = this._ensureStyleKernel(style);
    return this._activeStyleKernel;
  }

  /**
   * Create the renderTile handler bound to this instance
   * @private
   */
  _createRenderTileHandler() {
    return (tileDataResult) => {
      return renderTile(tileDataResult, this);
    };
  }

  /**
   * Create the getTileData handler bound to this instance
   * @private
   */
  _createGetTileDataHandler() {
    return (image, options = {}) => {
      this._ensureGpuFromDevice(options.device);

      if (!this.debug || options.debug === true) {
        return getTileData(image, options);
      }

      options.debug = true;
      return getTileData(image, options);
    };
  }

  /**
   * Destroy the multiband instance and release GPU resources
   */
  destroy() {
    if (this._gpu) {
      try {
        this._gpu.destroy();
        if (this.debug) {
          console.log('[Multiband] GPU resources released');
        }
      } catch (error) {
        console.error('[Multiband] Error destroying GPU:', error);
      }
      this._gpu = null;
      this._gpuContext = null;
    }

    this._styles.forEach((style) => {
      if (style && style.kernel && typeof style.kernel.destroy === 'function') {
        style.kernel.destroy();
      }
    });

    this._styles = [];
    this._activeStyleName = null;
    this._activeStyleKernel = null;
    this._cachedStyleNames = null;
    this._stylesCacheInvalid = true;

    if (this.debug) {
      console.log('[Multiband] Destroyed');
    }
  }
}

export { Multiband };
