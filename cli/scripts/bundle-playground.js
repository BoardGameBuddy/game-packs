#!/usr/bin/env node
// Copies playground/index.html from the repo root into cli/playground/
// so it is bundled with the npm package for standalone (out-of-repo) use.
'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'playground', 'index.html');
const destDir = path.join(__dirname, '..', 'playground');
const dest = path.join(destDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error(`bundle-playground: source file not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`bundle-playground: copied playground/index.html → cli/playground/index.html`);
