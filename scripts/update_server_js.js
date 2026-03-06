// Update server.js with corrected catalog
import fs from 'fs';

// Read current server.js
const serverJs = fs.readFileSync('server.js', 'utf8');

// Read corrected catalog
const newCatalog = fs.readFileSync('catalog_372_537_final.txt', 'utf8');

// Split server.js into lines
const lines = serverJs.split('\n');

// Find the start and end of the catalog
const catalogStart = lines.findIndex(line => line.includes('const SCRIPTURE_CATALOG = ['));
const catalogEnd = lines.findIndex((line, idx) => idx > catalogStart && line.trim() === '];');

console.log(`Catalog starts at line ${catalogStart + 1}`);
console.log(`Catalog ends at line ${catalogEnd + 1}`);
console.log(`Replacing ${catalogEnd - catalogStart - 1} lines with corrected catalog`);

// Build new file
const newLines = [
  ...lines.slice(0, catalogStart + 1), // Keep everything before catalog array
  ...newCatalog.split('\n'),             // Insert new catalog
  ...lines.slice(catalogEnd)             // Keep everything from ]; onwards
];

const newServerJs = newLines.join('\n');

// Save to new file
fs.writeFileSync('server.js.new', newServerJs);
console.log('\n✅ New server.js saved to server.js.new');
console.log('Please review and rename to server.js if correct');

// Show diff in number of lines
console.log(`\nLine count: ${lines.length} → ${newLines.length} (${newLines.length - lines.length > 0 ? '+' : ''}${newLines.length - lines.length})`);
