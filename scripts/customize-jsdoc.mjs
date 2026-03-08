#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docDir = path.resolve(__dirname, '..', 'doc');
const customCssPath = path.resolve(__dirname, 'jsdoc-custom.css');

// Copy custom CSS to doc/styles/
const targetCssPath = path.join(docDir, 'styles', 'jsdoc-custom.css');
fs.copyFileSync(customCssPath, targetCssPath);
console.log('✅ Copied custom CSS to doc/styles/');

// Copy favicon from example/ to doc/
const faviconSrc = path.resolve(__dirname, '..', 'example', 'favicon.ico');
const faviconDest = path.resolve(docDir, 'favicon.ico');
try {
  fs.copyFileSync(faviconSrc, faviconDest);
  console.log('✅ Copied favicon.ico to doc/');
} catch (e) {
  console.warn('⚠️ Could not copy favicon.ico:', e.message);
}

// Add custom CSS link to all HTML files
function processHtmlFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Replace "JSDoc" with "deck.gl-raster-multiband" in title
  content = content.replace(/<title>JSDoc: /g, '<title>deck.gl-raster-multiband ');

  // Inject favicon if not present
  if (!content.includes('rel="icon"')) {
    content = content.replace(
      /<head>([\s\S]*?)(<meta charset="utf-8">)/,
      '<head>$1$2\n    <link rel="icon" type="image/x-icon" href="favicon.ico">'
    );
  }

  // Add custom CSS link after jsdoc-default.css
  if (!content.includes('jsdoc-custom.css')) {
    content = content.replace(
      '<link type="text/css" rel="stylesheet" href="styles/jsdoc-default.css">',
      '<link type="text/css" rel="stylesheet" href="styles/jsdoc-default.css">\n    <link type="text/css" rel="stylesheet" href="styles/jsdoc-custom.css">'
    );
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

// Process all HTML files in doc directory
function processDirectory(dir) {
  let count = 0;
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      count += processDirectory(filePath);
    } else if (file.endsWith('.html')) {
      if (processHtmlFile(filePath)) {
        count++;
      }
    }
  }
  
  return count;
}

const filesProcessed = processDirectory(docDir);
console.log(`✅ Added custom CSS link to ${filesProcessed} HTML files`);
