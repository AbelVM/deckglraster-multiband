// Convert hex to normalized RGBA [0,1]
const hexToRGBA = (hex) => {
  const hexClean = hex.replace('#', '');
  const r = parseInt(hexClean.substring(0, 2), 16) / 255;
  const g = parseInt(hexClean.substring(2, 4), 16) / 255;
  const b = parseInt(hexClean.substring(4, 6), 16) / 255;
  const a = hexClean.length === 8 ? parseInt(hexClean.substring(6, 8), 16) / 255 : 1.0;
  return [r, g, b, a];
};

function addStyle(name, fn, options = {}) {
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

  const existingIndex = this._styles.findIndex((s) => s.name === name);
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

function removeStyle(name) {
  if (name === 'Band 1 - grayscale') {
    if (this.debug) {
      console.warn('[Multiband] Cannot remove default style "Band 1 - grayscale"');
    }
    return;
  }

  const index = this._styles.findIndex((s) => s.name === name);
  if (index >= 0) {
    const styleToRemove = this._styles[index];
    if (styleToRemove && styleToRemove.kernel && typeof styleToRemove.kernel.destroy === 'function') {
      styleToRemove.kernel.destroy();
    }
    this._styles.splice(index, 1);
    this._stylesCacheInvalid = true;

    if (this._activeStyleName === name) {
      this._activeStyleName = 'Band 1 - grayscale';
      const defaultStyle = this._styles.find((s) => s.name === 'Band 1 - grayscale');
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

function setActiveStyle(name, target, layerId = 'cog-layer') {
  const style = this._styles.find((s) => s.name === name);

  if (!style) {
    console.error(`[Multiband] Style not found: ${name}, defaulting to "Band 1 - grayscale"`);
    this._activeStyleName = 'Band 1 - grayscale';
    const defaultStyle = this._styles.find((s) => s.name === 'Band 1 - grayscale');
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

function getActiveStyle() {
  return this._activeStyleName;
}

function getStyles() {
  if (!this._cachedStyleNames || this._stylesCacheInvalid) {
    this._cachedStyleNames = this._styles.map((s) => s.name);
    this._stylesCacheInvalid = false;
  }
  return this._cachedStyleNames;
}

function _refreshTiles(target, layerId = 'cog-layer') {
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
        tileLayer = subLayers.find((sl) => sl.state && sl.state.tileset);
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

function _resolveDeckInstance(target) {
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

export {
  addStyle,
  removeStyle,
  setActiveStyle,
  getActiveStyle,
  getStyles,
  _refreshTiles,
  _resolveDeckInstance
};