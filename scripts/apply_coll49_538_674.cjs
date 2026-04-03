/**
 * Apply parts_538_674_coll49_raw.json to data.ts and server.js,
 * replacing the old (wrong collectionId=47) entries.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'parts_538_674_coll49_raw.json'), 'utf-8'));

function buildLine(e) {
  const flags = [];
  if (e.has0aPreface) flags.push(`has0aPreface: true`);
  if (e.mergeFileCount) flags.push(`mergeFileCount: ${e.mergeFileCount}`);
  if (e.trailingMergeCount > 1) flags.push(`trailingMergeCount: ${e.trailingMergeCount}`);
  const sc = e.trailingMergeCount > 1 ? e.rawScrollCount : e.scrollCount;
  const extra = flags.length ? ', ' + flags.join(', ') : '';
  return `  { part: ${e.part}, title: '${e.title}', subid: ${e.subid}, scrollCount: ${sc}, firstBookId: ${e.firstBookId}, collectionId: ${e.collectionId}${extra} },`;
}

const newLines = raw.map(buildLine);
const comment = '  // Parts 538-674: 小乘阿含部 (collection 49)';

// ─── server.js ────────────────────────────────────────────────────────────────
{
  let src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf-8');

  // Find and remove old 538-674 block (starts with the comment, ends at ];)
  const oldBlockStart = src.indexOf('  // Parts 538-674:');
  if (oldBlockStart === -1) throw new Error('Cannot find 538-674 block in server.js');
  const oldBlockEnd = src.indexOf('\n];', oldBlockStart) + 3; // include the ];
  const before = src.slice(0, oldBlockStart);
  const catalogClose = src.slice(oldBlockEnd - 2); // from ]; onwards
  src = before + comment + '\n' + newLines.join('\n') + '\n' + catalogClose;

  // Update header comment
  src = src.replace(
    /\/\/ CATALOG FOR PARTS 83-108[^\n]+\n\/\/ \+ PARTS 538-674[^\n]+/,
    '// CATALOG FOR PARTS 83-108 (大乘华严部, collection 45)\n// + PARTS 538-674 (小乘阿含部, collection 49)'
  );

  fs.writeFileSync(path.join(ROOT, 'server.js'), src, 'utf-8');
  console.log(`Updated server.js with ${newLines.length} entries (collection 49)`);
}

// ─── data.ts ──────────────────────────────────────────────────────────────────
{
  let src = fs.readFileSync(path.join(ROOT, 'data.ts'), 'utf-8');

  const oldBlockStart = src.indexOf('  // Parts 538-674:');
  if (oldBlockStart === -1) throw new Error('Cannot find 538-674 block in data.ts');
  const oldBlockEnd = src.indexOf('\n];', oldBlockStart) + 3;
  const before = src.slice(0, oldBlockStart);
  const catalogClose = src.slice(oldBlockEnd - 2);
  src = before + comment + '\n' + newLines.join('\n') + '\n' + catalogClose;

  // Update doc comment
  src = src.replace(
    /\/\*\*[\s\S]*?Collection IDs: 43, 47[\s\S]*?\*\//,
    '/**\n * Scripture Catalog: Parts 83-108 (大乘华严部) + Parts 538-674 (小乘阿含部)\n * Collection IDs: 45, 49\n * From xianmijingzang.com\n */'
  );

  fs.writeFileSync(path.join(ROOT, 'data.ts'), src, 'utf-8');
  console.log(`Updated data.ts with ${newLines.length} entries (collection 49)`);
}

console.log('Done. Run: npm run build');
