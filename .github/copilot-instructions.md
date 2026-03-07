# Project general coding guidelines

## Code Style
- Use semantic HTML5 elements (header, main, section, article, etc.)
- Prefer modern JavaScript (ES6+) features like const/let, arrow functions, and template literals

## Naming Conventions
- Use PascalCase for component names, interfaces, and type aliases
- Use camelCase for variables, functions, and methods
- Prefix private class members with underscore (_)
- Use ALL_CAPS for constants

## Code Quality
- Use meaningful variable and function names that clearly describe their purpose
- Include helpful comments for complex logic
- Add error handling for user inputs and API calls  

## Miscellaneous
- Analyze and use existing code in the `src` folder and the example in the `example` folder to understand how to implement the plugin and ensure compatibility with the existing codebase.
- Do not patch external dependencies directly in node_modules or in deck.gl-raster.
- Do not offer CPU fallbacks for GPU features. Instead, if a feature is not supported, throw an error and let the user know that their environment does not meet the requirements to run the project.
- Once fixed a bug, remove the instrumentation and console logs used to debug the issue.
- When debugging, prefer to add instrumentation and console logs in the project code rather than in external dependencies.
- Keep the instrumentation and console logs only for the duration of the debugging process, and remove them once the issue is resolved.
- Keep track of files to allow rollback if the patch does not work as expected or corrupt the files
- When asking for the next step among a set of options:
  - Number the options to make it easier to refer to them.
  - If one of the options is more likely to be correct, indicate that preference in your question.
- When asking for the next step among a set of options, provide a brief explanation of each option to help the user make an informed decision.
- use playwright for browser automation tasks, and prefer it over other tools like puppeteer or selenium.
- use pnmp for package management, and prefer it over npm or yarn.
- use vite for development and build, and prefer it over webpack or rollup.
- do not use any CSS preprocessor, and prefer plain CSS
- use https://www.npmjs.com/package/canvas for any canvas-related operations, and prefer it over other libraries like node-canvas or fabric.js.
- use luma.gl for color space conversions and operations like interpolation, and prefer it over other libraries like color-convert or chroma.js. Use chroma.js if luma.gl does not support a specific color space or operation, but prefer luma.gl for its GPU acceleration capabilities.
- use color interpolation in LAB color space, and prefer it over RGB or HSL for better perceptual results. Use luma.gl for color interpolation, and prefer it over chroma.js for its GPU acceleration capabilities. Use chroma.js if luma.gl does not support a specific color space or operation, but prefer luma.gl for its performance benefits.
- enforce https://github.com/proj4js/proj4js is version is v2.20.4 or higher
- import git@github.com:developmentseed/deck.gl-raster.git as a submodule for raster data processing
- to install gpu.js, use 
```bash
CC=gcc-11 CXX=g++-11 pnpm install gpu.js -w
```
- To install and build the project, use or improve the following commands:
```bash
git submodule update --init --recursive
pnpm install
pnpm --recursive build
```

## Initial prompt for plugin development

### Target

I want to build a javascript plugin as a library that enables github.com/developmentseed/deck.gl-raster to use multiband rasters by wiring the code actually in `src` folder and the example in `example` folder.

This plugin will make use of https://github.com/gpujs/gpu.js to make the logic run in a gpu kernel and it will be named `deck.gl-raster-multiband`. It will export a class called `multiband`.

The constructor will accept the following parameters:

- `debug`: boolean, default false, will enable/disable logging

This class will have the private properties:

- `_styles`: array of `multyband.style` objects like the one in `example/styles.js`. It will contains a default style called `Band 1 - grayscale` that will be the active one by default.

This class will have the public properties:

- `geoKeysParser`: the function of the same name defined in geokeysparser.js
- `getTileData`: the function of the same name defined in gettiledata.js
- `renderTile`: the function of the same name defined in rendertile.js

This class will have the public methods:

- `addStyle(name, fn)`: add an style to `multiband.styles`
- `removeStyle(name)`: remove an style from `multiband.styles`
- `setActiveStyle(name)`: apply the given style. If not found or error: log and default to `Band 1 - grayscale` 
- `getActiveStyle`: get the mane of the currently active style
- `getStyles`: get an array of current styles names
- `destroy`: destroy the `multiband` object and release resources, including gpu.js ones

The user of the plugin will need to:

- instantiate `multiband`
- optionally add styles to multiband to build an array of `multyband.style` objects like the ones in the `styles`array of `example/styles.js`
- set the active style or use default
- wire the geoKeysParser, getTileData, renderTile functions in COGLayer instatiation to the `multiband.*` ones


### Context

- The tiff in the example is a Sentinel 2 tiff with zero based bands, with values from 1 to 2^15
- gpu.js: https://github.com/gpujs/gpu.js
- deck.gl-raster: https://github.com/developmentseed/deck.gl-raster
- proj4js: https://github.com/proj4js/proj4js
- canvas: https://github.com/Automattic/node-canvas

### The example

The example should use only:
- MaplibreGLJS
- deck.gl raster
- deck.gl Mapbox Overlay
- The plugin itself

It will have an styles.js file with an styles array of styles, as the current one. It will have a select box.

Then:

1. Instantiate multiband
2. Add styles to multiband using the list in styles.js
3. Populate the select options with the available styles in multiband
4. Active `True Color` style and sync the select
5. The active style should change on change event of the select and propagate to rendertile

## Documentation

Populate the readme.md with the project info and API documentation

Add a callout regarding that the bands values range may vary but the values in `this.color` property of the style function must be normalized to the range 0 to 1