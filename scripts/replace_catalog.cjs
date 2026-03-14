/**
 * Replace SCRIPTURE_CATALOG entries in data.ts and server.js
 * with parts 675-776 (collectionId 50).
 */
const fs = require('fs');
const path = require('path');

const parts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'parts_675_776_final.json'), 'utf-8'));

// Build new catalog entries
const catalogLines = parts.map(p => {
  const extra = p.has0a ? ', has0aPreface: true' : '';
  return `  { part: ${p.partNum}, title: '${p.title}', subid: ${p.subid}, scrollCount: ${p.scrollCount}, firstBookId: ${p.firstBookId}, collectionId: 50${extra} }`;
}).join(',\n');

const newCatalog = `export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [\n${catalogLines}\n];`;

// Also build for server.js (no export, no type annotation)
const serverCatalogLines = parts.map(p => {
  const extra = p.has0a ? ', has0aPreface: true' : '';
  return `  { part: ${p.partNum}, title: '${p.title}', subid: ${p.subid}, scrollCount: ${p.scrollCount}, firstBookId: ${p.firstBookId}, collectionId: 50${extra} }`;
}).join(',\n');

const newServerCatalog = `const SCRIPTURE_CATALOG = [\n${serverCatalogLines}\n];`;

// Replace in data.ts
const dataPath = path.join(__dirname, '..', 'data.ts');
let dataContent = fs.readFileSync(dataPath, 'utf-8');

// Replace the catalog array
dataContent = dataContent.replace(
  /export const SCRIPTURE_CATALOG: ScriptureCatalogEntry\[\] = \[[\s\S]*?\];/,
  newCatalog
);

// Update CATALOG_BASE_URL
dataContent = dataContent.replace(
  /const CATALOG_BASE_URL = 'https:\/\/w1\.xianmijingzang\.com\/wap\/tripitaka\/id\/\d+\/subid\/';/,
  "const CATALOG_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/50/subid/';"
);

// Update the comment
dataContent = dataContent.replace(
  /Scripture Catalog: Parts \d+-\d+\n \* Collection ID: \d+/,
  'Scripture Catalog: Parts 675-776\n * Collection ID: 50'
);

fs.writeFileSync(dataPath, dataContent);
console.log(`Updated data.ts with ${parts.length} entries`);

// Replace in server.js
const serverPath = path.join(__dirname, '..', 'server.js');
let serverContent = fs.readFileSync(serverPath, 'utf-8');

serverContent = serverContent.replace(
  /const SCRIPTURE_CATALOG = \[[\s\S]*?\];/,
  newServerCatalog
);

// Update the comment
serverContent = serverContent.replace(
  /CATALOG FOR PARTS \d+-\d+ \(collection \d+\)/,
  'CATALOG FOR PARTS 675-776 (collection 50)'
);

fs.writeFileSync(serverPath, serverContent);
console.log(`Updated server.js with ${parts.length} entries`);
