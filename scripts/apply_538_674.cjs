/**
 * Apply parts_538_674_raw.json catalog entries to data.ts and server.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rawData = JSON.parse(fs.readFileSync(path.join(ROOT, 'parts_538_674_raw.json'), 'utf-8'));

// Build catalog lines for the new entries
function buildCatalogLine(e) {
  const flags = [];
  if (e.has0aPreface) flags.push(`has0aPreface: true`);
  if (e.mergeFileCount) flags.push(`mergeFileCount: ${e.mergeFileCount}`);
  if (e.trailingMergeCount > 1) flags.push(`trailingMergeCount: ${e.trailingMergeCount}`);
  // For trailing merge entries: store rawScrollCount so server can compute bookIds correctly
  const sc = e.trailingMergeCount > 1 ? e.rawScrollCount : e.scrollCount;
  const extra = flags.length ? ', ' + flags.join(', ') : '';
  return `  { part: ${e.part}, title: '${e.title}', subid: ${e.subid}, scrollCount: ${sc}, firstBookId: ${e.firstBookId}, collectionId: ${e.collectionId}${extra} },`;
}

const newLines = rawData.map(buildCatalogLine);

// ─── Update server.js ────────────────────────────────────────────────
{
  const serverPath = path.join(ROOT, 'server.js');
  let src = fs.readFileSync(serverPath, 'utf-8');

  // Replace the catalog header comment + array
  const oldHeader = `// ============================================\n// CATALOG FOR PARTS 83-108 (大乘华严部, collection 43)\n// ============================================`;
  const newHeader = `// ============================================\n// CATALOG FOR PARTS 83-108 (大乘华严部, collection 43)\n// + PARTS 538-674 (小乘阿含部, collection 47)\n// ============================================`;
  src = src.replace(oldHeader, newHeader);

  // Insert new entries before the closing `];` of SCRIPTURE_CATALOG
  const closingMarker = `  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },\n];`;
  const replacement = `  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },\n  // Parts 538-674: 小乘阿含部 (collection 47)\n${newLines.join('\n')}\n];`;

  if (!src.includes(closingMarker)) {
    console.error('ERROR: Could not find closing marker in server.js');
    process.exit(1);
  }
  src = src.replace(closingMarker, replacement);

  fs.writeFileSync(serverPath, src, 'utf-8');
  console.log(`Updated server.js (+${newLines.length} entries)`);
}

// ─── Update data.ts ───────────────────────────────────────────────────
{
  const dataTsPath = path.join(ROOT, 'data.ts');
  let src = fs.readFileSync(dataTsPath, 'utf-8');

  // Update comment block
  src = src.replace(
    /\/\*\*\n \* Scripture Catalog: Parts 83-108[^\*]*\*\//,
    `/**\n * Scripture Catalog: Parts 83-108 (大乘华严部) + Parts 538-674 (小乘阿含部)\n * Collection IDs: 43, 47\n * From xianmijingzang.com\n */`
  );

  // Insert new entries before the closing `];` of SCRIPTURE_CATALOG
  const closingMarker = `  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },\n];`;
  const replacement = `  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },\n  // Parts 538-674: 小乘阿含部 (collection 47)\n${newLines.join('\n')}\n];`;

  if (!src.includes(closingMarker)) {
    console.error('ERROR: Could not find closing marker in data.ts');
    process.exit(1);
  }
  src = src.replace(closingMarker, replacement);

  // Fix CATALOG_BASE_URL: data.ts uses a single base URL const, but now we have two collections.
  // The readingUrl is already computed dynamically in createCatalogVolumes using entry.collectionId,
  // so just remove the unused CATALOG_BASE_URL const (it was already replaced in createCatalogVolumes).
  src = src.replace(
    /const CATALOG_BASE_URL = 'https:\/\/w1\.xianmijingzang\.com\/wap\/tripitaka\/id\/\d+\/subid\/';\n\n/,
    ''
  );

  fs.writeFileSync(dataTsPath, src, 'utf-8');
  console.log(`Updated data.ts (+${newLines.length} entries)`);
}

console.log('Done. Now bump DB_KEY in dbService.ts to v15 and run npm run build.');
