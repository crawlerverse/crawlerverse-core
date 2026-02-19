/**
 * Copies @3d-dice/dice-box assets to public directory.
 *
 * This script is kept in crawler-core so the package remains self-contained
 * when published to npm as a standalone package.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../node_modules/@3d-dice/dice-box/dist/assets');
const dest = path.join(__dirname, '../public/dice-box-assets');

// Check if source exists (might not if package not installed)
if (!fs.existsSync(src)) {
  console.log('dice-box assets not found, skipping copy');
  process.exit(0);
}

// Create destination directory
fs.mkdirSync(dest, { recursive: true });

// Copy recursively
function copyRecursive(srcPath, destPath) {
  const stats = fs.statSync(srcPath);
  if (stats.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    for (const file of fs.readdirSync(srcPath)) {
      copyRecursive(path.join(srcPath, file), path.join(destPath, file));
    }
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

copyRecursive(src, dest);
console.log('Copied dice-box assets to public/dice-box-assets');
