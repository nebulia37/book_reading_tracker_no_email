// Update data.ts with corrected catalog
import fs from 'fs';

// Read current data.ts
const dataTs = fs.readFileSync('data.ts', 'utf8');

// Read corrected catalog
const newCatalog = fs.readFileSync('catalog_372_537_final.txt', 'utf8');

// Split data.ts into lines
const lines = dataTs.split('\n');

// Find the start and end of the catalog
const catalogStart = lines.findIndex(line => line.includes('export const SCRIPTURE_CATALOG'));
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

const newDataTs = newLines.join('\n');

// Save to new file
fs.writeFileSync('data.ts.new', newDataTs);
console.log('\n✅ New data.ts saved to data.ts.new');
console.log('Please review and rename to data.ts if correct');

// Show diff in number of lines
console.log(`\nLine count: ${lines.length} → ${newLines.length} (${newLines.length - lines.length > 0 ? '+' : ''}${newLines.length - lines.length})`);
