import { GPU } from 'gpu.js';
import { geoKeysParser } from './geoKeysParser.js';
import { getTileData } from './getTileData.js';
import { renderTile } from './renderTile.js';
import {
  addStyle,
  removeStyle,
  setActiveStyle,
  getActiveStyle,
  getStyles,
  _refreshTiles,
  _resolveDeckInstance
} from './stylesManager.js';
import {
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
} from './getPixelValues.js';

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

    const activeStyle = this._styles.find((s) => s.name === this._activeStyleName)
      || this._styles.find((s) => s.name === 'Band 1 - grayscale')
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

    const style = this._styles.find((s) => s.name === this._activeStyleName);

    if (!style) {
      if (this.debug) {
        console.warn(`[Multiband] Style "${this._activeStyleName}" not found, falling back to default`);
      }
      const defaultStyle = this._styles.find((s) => s.name === 'Band 1 - grayscale');
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

Object.assign(Multiband.prototype, {
  addStyle,
  removeStyle,
  setActiveStyle,
  getActiveStyle,
  getStyles,
  _refreshTiles,
  _resolveDeckInstance,
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
});

export { Multiband };
