#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Read package.json for project info
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));

// Read README.md
const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');

// Extract main sections from README
const extractSection = (content, heading) => {
  const regex = new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |$)`, 'i');
  const match = content.match(regex);
  return match ? match[0] : '';
};

const features = extractSection(readme, 'Features');
const quickStart = extractSection(readme, 'Quick Start');
const installation = extractSection(readme, 'Installation');

// Generate llms.txt content following llmstxt.org format
const llmsTxt = `# ${pkg.name}

> ${pkg.description}

## Overview

${pkg.name} is a JavaScript plugin that enables GPU-accelerated multiband raster algebra and styling for deck.gl-raster using GPU.js.

- **Version**: ${pkg.version}
- **License**: ${pkg.license}
- **Author**: ${pkg.author}
- **Repository**: ${pkg.repository.url.replace('git@github.com:', 'https://github.com/').replace('.git', '')}
- **Live Demo**: https://abelvm.github.io/deckglraster-multiband/
- **Documentation**: https://abelvm.github.io/deckglraster-multiband/doc/

${features}

## Installation

\`\`\`bash
npm install ${pkg.name}
# or
pnpm add ${pkg.name}
# or
yarn add ${pkg.name}
\`\`\`

${quickStart}

## API Documentation

Complete API documentation is available at:
- **JSDoc**: https://abelvm.github.io/deckglraster-multiband/doc/
- **Main Class**: Multiband
- **Key Methods**: addStyle, setActiveStyle, getPixelValues, renderTile

## Key Concepts

### Multiband Raster Processing
This library processes multiband raster data (e.g., satellite imagery) using GPU.js for hardware acceleration. It compiles JavaScript functions into WebGL shaders for efficient pixel-level operations.

### Style System
Styles are GPU kernels that define how band data is transformed into RGBA colors:
- **Type 1 (Direct RGBA)**: Function returns [r, g, b, a] directly
- **Type 2 (Gradient)**: Function returns scalar value, colors are mapped via LUT

### Integration with deck.gl
Seamlessly integrates with deck.gl's COGLayer for Cloud Optimized GeoTIFF rendering.

## Source Files

- \`src/index.js\` - Main Multiband class
- \`src/stylesManager.js\` - Style management API
- \`src/renderTile.js\` - GPU kernel execution and WebGL rendering
- \`src/getTileData.js\` - GeoTIFF tile data loading
- \`src/getPixelValues.js\` - Pixel sampling and value extraction
- \`src/geoKeysParser.js\` - Projection/CRS parsing

## Dependencies

- **gpu.js** (^2.16.0): GPU-accelerated computing
- **proj4** (>=2.20.4): Coordinate system transformations
- **@deck.gl/core**, **@deck.gl/geo-layers** (^9.2.11): Peer dependencies for deck.gl integration

## Browser Support

Requires WebGL2 support (modern browsers: Chrome 56+, Firefox 51+, Safari 15+, Edge 79+).

## Contributing

Contributions are welcome! This project uses:
- **Build**: Vite 6.0.0
- **Package Manager**: pnpm
- **License**: AGPL-3.0-only

## Links

- GitHub: ${pkg.repository.url.replace('git@github.com:', 'https://github.com/').replace('.git', '')}
- Live Demo: https://abelvm.github.io/deckglraster-multiband/
- Documentation: https://abelvm.github.io/deckglraster-multiband/doc/
- npm: https://www.npmjs.com/package/${pkg.name}
`;

// Write llms.txt to project root
fs.writeFileSync(path.join(projectRoot, 'llms.txt'), llmsTxt, 'utf-8');
console.log('✅ Generated llms.txt');
