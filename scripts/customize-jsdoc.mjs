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

// Add custom CSS link to all HTML files
function processHtmlFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Check if custom CSS is already included
  if (content.includes('jsdoc-custom.css')) {
    return false;
  }
  
  // Add custom CSS link after jsdoc-default.css
  content = content.replace(
    '<link type="text/css" rel="stylesheet" href="styles/jsdoc-default.css">',
    '<link type="text/css" rel="stylesheet" href="styles/jsdoc-default.css">\n    <link type="text/css" rel="stylesheet" href="styles/jsdoc-custom.css">'
  );
  
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
