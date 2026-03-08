# deck.gl-raster-multiband

A JavaScript plugin that enables GPU-accelerated multiband raster algebra and styling for [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) using [GPU.js](https://github.com/gpujs/gpu.js).

Live demo: https://abelvm.github.io/deckglraster-multiband/

## Table of Contents

- [Features](#features)
- [Installation](#installation)
  - [Install From Source (Recommended)](#install-from-source-recommended)
  - [Build Commands](#build-commands)
  - [Documentation](#documentation)
  - [Install As Dependency](#install-as-dependency)
  - [Using from CDN](#using-from-cdn)
- [Installation Troubleshooting: GPU.js Build Issues](#installation-troubleshooting-gpujs-build-issues)
  - [Common Issues](#common-issues)
- [Package Exports](#package-exports)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [Constructor](#constructor)
  - [Render Output Modes](#render-output-modes)
  - [Public Properties](#public-properties)
  - [Public Methods](#public-methods)
    - [`addStyle(name, fn, options)`](#addstylename-fn-options)
    - [`removeStyle(name)`](#removestylename)
    - [`setActiveStyle(name, target, layerId)`](#setactivestylename-target-layerid)
    - [`getActiveStyle()`](#getactivestyle)
    - [`getStyles()`](#getstyles)
    - [`getPixelValues(lngLat, target, layerId)`](#getpixelvalueslnglat-target-layerid)
    - [`destroy()`](#destroy)
- [GPU.js Kernel Limitations](#gpujs-kernel-limitations)
- [Styling Quick Reference](#styling-quick-reference)
- [Dependencies](#dependencies)
- [Browser Support](#browser-support)
- [License](#license)
- [Contributing](#contributing)
- [Example](#example)

## Features

- 🚀 GPU-accelerated multiband raster algebra and styling using GPU.js
- 🎨 Flexible style system for custom band combinations
- 🔄 Dynamic style switching at runtime
- 🔌 Easy integration with deck.gl COGLayer
- 🧪 Pixel sampling API with style-aware value evaluation (`getPixelValues`)

## Installation

### Install From Source (Recommended)

```bash
pnpm run setup
```

### Build Commands

```bash
# Build the library to dist/
pnpm run build:lib

# Build the example app for local development (base path: /)
pnpm run build:example:local

# Build the example app for deployment to GitHub Pages (base path: /deckglraster-multiband/)
pnpm run build:example:deploy

# Build both library and example (uses deploy settings for example)
pnpm run build:all

# Generate JSDoc documentation to doc/
pnpm run build:docs

# Build everything (library, example, and docs)
pnpm run release

# Deploy to GitHub Pages (builds, commits, and pushes to gh-pages branch)
# Optional: provide custom commit message
pnpm run deploy
pnpm run deploy "feat: add new feature"

# If you plan to build all submodule packages/examples, install its deps once
cd deck.gl-raster && pnpm install && cd ..
```

### Documentation

Generated JSDoc documentation is available:
- **Online**: [https://abelvm.github.io/deckglraster-multiband/doc/](https://abelvm.github.io/deckglraster-multiband/doc/)
- **Local**: In the [`doc/`](doc/) folder after running `pnpm run build:docs`. Open [`doc/index.html`](doc/index.html) to view the complete API documentation.

### Install As Dependency

```bash
pnpm add deck.gl-raster-multiband
```

### Using from CDN

For quick prototyping or when you don't use a build system, load the UMD bundle from a CDN:

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/deck.gl-raster-multiband/dist/deck.gl-raster-multiband.umd.js"></script>
</head>
<body>
  <script>
    // Access via global: DeckGLRasterMultiband
    const multiband = new DeckGLRasterMultiband.Multiband({ debug: true });
    
    // Add styles and use as shown in Quick Start
    multiband.addStyle('True Color', function(data) {
      const r = Math.max(0, Math.min(1, data[3][this.thread.y][this.thread.x] * 0.00003051757));
      const g = Math.max(0, Math.min(1, data[2][this.thread.y][this.thread.x] * 0.00003051757));
      const b = Math.max(0, Math.min(1, data[1][this.thread.y][this.thread.x] * 0.00003051757));
      return [r, g, b, 0.8];
    });
    
    multiband.setActiveStyle('True Color');
  </script>
</body>
</html>
```

**CDN Options:**
- **unpkg**: `https://unpkg.com/deck.gl-raster-multiband/dist/deck.gl-raster-multiband.umd.js`
- **jsDelivr**: `https://cdn.jsdelivr.net/npm/deck.gl-raster-multiband/dist/deck.gl-raster-multiband.umd.js`

The UMD bundle includes `gpu.js` and `proj4` dependencies (~554 kB, ~145 kB gzipped).

## Installation Troubleshooting: GPU.js Build Issues

[GPU.js](https://github.com/gpujs/gpu.js) requires native compilation of the [`gl`](https://github.com/stackgl/headless-gl) package, which can fail on some systems due to missing OS dependencies or GCC version incompatibilities.

### Common Issues

**On Ubuntu/Debian:**

The build may fail due to missing X11 development libraries and older GCC versions. Refer to [GPU.js Issue #770](https://github.com/gpujs/gpu.js/issues/770) for detailed discussion and workarounds.

**Required OS Dependencies (Ubuntu/Debian):**

```bash
sudo apt-get install -y libxi-dev gcc-11 g++-11
```

**Build with GCC-11 (Required on some systems):**

If your system has GCC13+ (which has stricter header requirements incompatible with the gl package), force GCC-11:

```bash
CC=gcc-11 CXX=g++-11 pnpm install
```

Or use the provided setup script (recommended):

```bash
pnpm run setup
```

This script automatically runs initialization and package installation with GCC-11 constraints.

**On macOS & Windows:**

See [GPU.js Issue #770](https://github.com/gpujs/gpu.js/issues/770) for platform-specific solutions including Visual Studio and Xcode compatibility workarounds.

**Alternative: Use Prebuilt Binaries**

If native compilation fails, you can override the `gl` dependency to use prebuilt binaries:

```json
{
  "overrides": {
    "gpu.js": {
      "gl": {
        "node-gyp": ">7.0.0"
      }
    }
  }
}
```

## Package Exports

This package exports a single symbol:

- `Multiband`

## Quick Start

```javascript
import { Multiband } from 'deck.gl-raster-multiband';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';

// 1. Create a multiband instance
const multiband = new Multiband({ debug: true });

// 2. Add custom styles
multiband.addStyle('True Color', function(data) {
  const r = Math.max(0, Math.min(1, data[3][this.thread.y][this.thread.x] * 0.00003051757));
  const g = Math.max(0, Math.min(1, data[2][this.thread.y][this.thread.x] * 0.00003051757));
  const b = Math.max(0, Math.min(1, data[1][this.thread.y][this.thread.x] * 0.00003051757));
  return [r, g, b, 0.8];
});

// 3. Set the active style
multiband.setActiveStyle('True Color');

// 4. Use with COGLayer
const layer = new COGLayer({
  id: 'cog-layer',
  geotiff: 'path/to/your/geotiff.tif',
  geoKeysParser: multiband.geoKeysParser,
  getTileData: multiband.getTileData,
  renderTile: multiband.renderTile
});
```

## API Reference

### Constructor

#### `new Multiband(options)`

Creates a new Multiband instance.

**Parameters:**

- `options` (Object, optional)
- `options.debug` (boolean, default: `false`) - Enable/disable console logging

**Example:**

```javascript
const multiband = new Multiband({ debug: true });
```

### Render Output Modes

- `raster-modules` (default): renders on GPU and returns `RasterModule[]` backed by a luma texture.

Current implementation always returns `RasterModule[]` from `renderTile`.

---

### Public Properties

#### `multiband.geoKeysParser`

Function to parse GeoTIFF projection keys. Pass this to COGLayer's `geoKeysParser` prop.

#### `multiband.getTileData`

Function to fetch and process tile data. Pass this to COGLayer's `getTileData` prop.

#### `multiband.renderTile`

Function to render tiles using the active style. Pass this to COGLayer's `renderTile` prop.

---

### Public Methods

#### `addStyle(name, fn, options)`

Add a new style or update an existing one. Supports two types of styles:

**Type 1 - Direct RGBA (Traditional):**
The function returns `[r, g, b, a]` directly.

**Type 2 - Gradient-based:**
The function returns a scalar in channel 0 (`[scalar, 0, 0, alpha]`), and `options.colors` + `options.stops` define the gradient ramp.
The plugin builds a 256-entry LUT on CPU and applies it in a lightweight GPU lookup pass.

When you call `addStyle(...)` directly, pass gradient fields in the third argument (`options`).
When you use a style-list object (like `example/assets/styles.js`), `colors`/`stops`/`domain` are typically at the root of each style object and then mapped into `options` by your app code.

Type 2 runtime details:

- LUT generation is cached per style and reused across tile renders.
- GPU lookup index is clamped to LUT bounds (`0..255`) for out-of-domain scalar safety.

**Parameters:**

- `name` (string) - Unique style name
- `fn` (Function) - GPU.js kernel function that processes band data
  - For Type 1: Must return `[r, g, b, a]` where each value is in `[0, 1]`
  - For Type 2: Must return `[scalar, 0, 0, alpha]`
- `options` (Object, optional) - Configuration for gradient-based styles (Type 2)
  - `options.colors` (string[]) - Array of hex color strings (e.g., `['#FF0000', '#00FF00']`)
  - `options.stops` (number[]) - Array of stop values corresponding to colors
  - `options.domain` (number[]) - Optional scalar domain `[min, max]` for LUT mapping; must contain exactly 2 finite values with `max > min`

`options.colors.length` must equal `options.stops.length` and at least 2 stops/colors are required.

If `options.domain` is omitted, scalar values use default domain `[-1, 1]`.
For NDVI-style indices, keeping `stops` inside `[-1, 1]` is recommended unless you set a different `options.domain`.

Style-list object shape (common in `styles.js`):

```javascript
{
  name: 'NDVI',
  fn: function(data) { /* ... */ },
  colors: ['#a50026', '#d73027', '#006837'],
  stops: [-0.2, 0.0, 0.8],
  domain: [-1.0, 1.0]
}
```

Adapter example (style-list object -> `addStyle(..., options)`):

```javascript
const options = {};
if (style.colors) options.colors = style.colors;
if (style.stops) options.stops = style.stops;
if (style.domain) options.domain = style.domain;
multiband.addStyle(style.name, style.fn, options);
```

**Important:** The style function must be written using **GPU.js kernel syntax**. In the current implementation, styles are **non-graphical pipeline kernels**. The function cannot access external variables, use certain JavaScript features, or call non-Math standard library functions. See the [GPU.js Kernel Limitations](#gpujs-kernel-limitations) section below for complete details.

**Example (Type 1 - Direct RGBA):**

```javascript
// Traditional approach: compute colors directly
multiband.addStyle('True Color', function(data) {
  const r = Math.max(0, Math.min(1, data[3][this.thread.y][this.thread.x] * 0.00003051757));
  const g = Math.max(0, Math.min(1, data[2][this.thread.y][this.thread.x] * 0.00003051757));
  const b = Math.max(0, Math.min(1, data[1][this.thread.y][this.thread.x] * 0.00003051757));
  return [r, g, b, 0.8];
});
```

**Example (Type 2 - Gradient-based):**

```javascript
// New approach: compute scalar, define gradient separately
multiband.addStyle('NDVI', function(data) {
  const b4 = data[3][this.thread.y][this.thread.x]; // Red
  const b8 = data[7][this.thread.y][this.thread.x]; // NIR
  const denom = b8 + b4;
  const ndvi = denom === 0 ? 0.0 : (b8 - b4) / denom;
  const a = (b4 === 0 && b8 === 0) ? 0.0 : 0.8;
  return [ndvi, 0, 0, a]; // scalar in channel 0
}, {
  colors: [
    '#a50026', // -0.2: Deep red (bare soil)
    '#d73027', //  0.0: Red
    '#fdae61', //  0.2: Orange
    '#fee08b', //  0.3: Light yellow
    '#a6d96a', //  0.5: Light green
    '#66bd63', //  0.6: Green
    '#006837'  //  0.8: Deep green (dense vegetation)
  ],
  stops: [-0.2, 0.0, 0.2, 0.3, 0.5, 0.6, 0.8],
  domain: [-1.0, 1.0]
});
```

**Benefits of Gradient-based Styles:**

- **Cleaner separation** of calculation and visualization logic
- **Reusable color schemes** - same calculation, different palettes
- **Less code duplication** for similar indices (NDVI, NDWI, EVI, etc.)
- **Stable GPU application** via LUT lookup in the second pass

**Common Mistakes Checklist:**

- Returning non-normalized color channels in Type 1 styles (all output channels must be in `[0, 1]`)
- Returning direct RGB from a Type 2 style instead of `[scalar, 0, 0, alpha]`
- Passing mismatched `colors` and `stops` lengths
- Defining `stops` outside expected scalar domain (or forgetting to set `options.domain` for non-NDVI ranges)
- Using complex branching or unsupported syntax in style kernels (simplify kernel logic)
- Forgetting to call `setActiveStyle(...)` after adding a new style

#### `removeStyle(name)`

Remove a style from the collection.

**Parameters:**

- `name` (string) - Style name to remove

**Note:** The default style "Band 1 - grayscale" cannot be removed.

**Example:**

```javascript
multiband.removeStyle('NDVI');
```

#### `setActiveStyle(name, target, layerId)`

Set the active rendering style.

**Parameters:**

- `name` (string) - Style name to activate
- `target` (Object, optional) - deck.gl instance, or map-like object exposing `__deck`; when provided, tiles are refreshed immediately
- `layerId` (string, optional, default: `'cog-layer'`) - COGLayer id used when refreshing tiles

**Note:** If the style is not found, it defaults to "Band 1 - grayscale" and logs an error.

**Example:**

```javascript
multiband.setActiveStyle('True Color');

// Optionally refresh tiles immediately
multiband.setActiveStyle('NDVI', deckInstance, 'cog-layer');
```

#### `getActiveStyle()`

Get the name of the currently active style.

**Returns:** `string` - Active style name

**Example:**

```javascript
const activeName = multiband.getActiveStyle();
console.log('Current style:', activeName);
```

#### `getStyles()`

Get an array of all available style names.

**Returns:** `string[]` - Array of style names

**Example:**

```javascript
const styleNames = multiband.getStyles();
console.log('Available styles:', styleNames);
```

#### `getPixelValues(lngLat, target, layerId)`

Sample the clicked pixel from currently loaded tiles and evaluate the active style at that pixel.

**Parameters:**

- `lngLat` (Array|Object) - Click position as `[lng, lat]` or `{lng, lat}`
- `target` (Object) - deck instance or map-like object exposing `__deck`
- `layerId` (string, optional, default: `'cog-layer'`) - COGLayer id

**Returns:** `Object|null`

```javascript
{
  latlng: { lat, lng },
  selectedstyle: 'Style Name',
  value,   // Type 1: direct fn output, Type 2: scalar fn output (channel 0)
  bands    // raw band array at sampled pixel
}
```

Type-specific `value` behavior:

- Type 1 style: `value` is the direct output returned by style `fn`.
- Type 2 style: `value` is the scalar computed by style `fn` (first element of `[scalar, 0, 0, alpha]`), without applying gradient colorization.

The method automatically resolves tile bounds CRS and transforms click coordinates to match projected tile coordinates when needed.

**Example:**

```javascript
const sample = multiband.getPixelValues(event.lngLat, map, 'cog-layer');
if (sample) {
  console.log(`${sample.selectedstyle}:`, sample.value);
  console.log('Bands:', sample.bands);
}
```

#### `destroy()`

Destroy the multiband instance and release GPU resources.

**Example:**

```javascript
multiband.destroy();
```

---

## GPU.js Kernel Limitations

Style functions run as GPU kernels and have important restrictions:

### ❌ Cannot Access External Variables in Style Kernels

```javascript
// ❌ WRONG: Cannot access external palette array
const colorPalette = [[1,0,0], [0,1,0], [0,0,1]];
multiband.addStyle('Bad', function(data) {
  const color = colorPalette[0]; // ERROR: unhandled member expression
  return [color[0], color[1], color[2], 1];
});

// ✅ CORRECT: Inline all values
multiband.addStyle('Good', function(data) {
  const r = 1, g = 0, b = 0; // Inline values
  return [r, g, b, 1];
});
```

### ❌ Avoid Complex Conditional Patterns in Style Kernels

```javascript
// ❌ Risky in GPU.js kernels depending on transpilation target
if (a > b && c < d) {
  // ...
}

// ✅ Prefer simple arithmetic and ternary patterns
const valid = (a > b) ? 1.0 : 0.0;
```

### ❌ Limited Built-in Functions

GPU.js supports only basic `Math` functions: `abs`, `max`, `min`, `sqrt`, `pow`, `round`, `floor`, `ceil`, `sin`, `cos`, `tan`, etc. Complex operations must be implemented manually.

### ✅ Best Practices

- **Type 1**: Return normalized `[r, g, b, a]`
- **Type 2**: Return `[scalar, 0, 0, alpha]` and provide `colors/stops` in `addStyle`
- **Pre-normalize constants**: Store normalized values (e.g., `0.00003051757`) rather than calculating `1/32768` in the kernel
- **Keep kernel logic simple**: avoid deeply nested branching
- **Keep it simple**: Complex logic may fail to compile or run slowly

---

## Styling Quick Reference

Style kernels receive `data[band][y][x]` and use `this.thread.y` / `this.thread.x`.

> **Important:** Band source values vary by dataset, but output channels must always be normalized to `[0, 1]`.

### Type 1: Direct RGBA

```javascript
multiband.addStyle('True Color', function(data) {
  const r = Math.max(0, Math.min(1, data[3][this.thread.y][this.thread.x] * 0.00003051757));
  const g = Math.max(0, Math.min(1, data[2][this.thread.y][this.thread.x] * 0.00003051757));
  const b = Math.max(0, Math.min(1, data[1][this.thread.y][this.thread.x] * 0.00003051757));
  const a = (r === 0 && g === 0 && b === 0) ? 0.0 : 0.8;
  return [r, g, b, a];
});
```

### Type 2: Scalar + Gradient

```javascript
multiband.addStyle('NDVI', function(data) {
  const b4 = data[3][this.thread.y][this.thread.x];
  const b8 = data[7][this.thread.y][this.thread.x];
  const denom = b8 + b4;
  const ndvi = denom === 0 ? 0.0 : (b8 - b4) / denom;
  const a = (b4 === 0 && b8 === 0) ? 0.0 : 0.8;
  return [ndvi, 0, 0, a];
}, {
  colors: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
  stops: [-0.2, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  domain: [-1.0, 1.0]
});
```

If `domain` is omitted, the default scalar domain is `[-1, 1]`.

For a complete working setup (MapLibre, selector wiring, style list), see:

- `example/assets/styles.js`
- `example/assets/app.js`
- `example/assets/selector.js`

Selector wiring note:

- `initSelector(...)` emits only `onStyleChange(name)`.
- Apply style once in your callback (for example, `setActiveStyle(name, map, 'cog-layer')`) to avoid duplicate refresh work.

---

## Dependencies

- [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster) - Raster layer support for deck.gl
- [GPU.js](https://github.com/gpujs/gpu.js) - GPU-accelerated JavaScript
- [proj4js](https://github.com/proj4js/proj4js) v2.20.4 or higher - Coordinate system transformations

## Browser Support

This library requires WebGL2 support. Most modern browsers support WebGL2, but users on older browsers or devices may experience issues.

Build note: `vite.config.js` aliases `child_process`/`node:child_process` to a browser shim (`example/shims/child-process.js`) so browser bundles do not fail on Node-only optional paths in transitive dependencies.

## License

This library is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**.

### What This Means

The AGPL-3.0 is a strong copyleft license that:

- ✅ **Allows free use** for open-source projects
- ✅ **Permits modification and distribution** as long as you share your modifications under the same license
- ⚠️ **Requires source code disclosure** if you use this library in a network service or web application (even without distributing it)
- ❌ **Not suitable for proprietary/closed-source commercial applications** unless you're willing to open-source your entire codebase

### Commercial Use Limitations

If you want to use this library in a **commercial, closed-source application** without releasing your source code, the AGPL-3.0 license does not allow this by default.

### Commercial Licensing

**Interested in a commercial license?** If you need to use this library in a proprietary application without the AGPL-3.0 restrictions, please contact me to discuss commercial licensing options:

- **GitHub**: Open an issue or discussion in this repository
- **Email**: Contact information available in my GitHub profile

A commercial license would allow you to:

- Use the library in closed-source applications
- Modify the library without disclosing your changes
- Integrate it into proprietary products

For more details, see the full [LICENSE](LICENSE) file.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Example

**Live demo: https://abelvm.github.io/deckglraster-multiband/**

See the [example](./example) directory for a complete working example with MapLibre GL JS.

The example raster source was taken from [geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol).

To run the example:

```bash
pnpm run setup
pnpm run dev
```

Vite will print the local URL in terminal (typically `http://localhost:5173/`; if busy, it will automatically use another port such as `5174`).
