import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read data.ts
const dataTs = fs.readFileSync(path.join(__dirname, '..', 'data.ts'), 'utf8');

// Extract SCRIPTURE_CATALOG entries
const catalogMatch = dataTs.match(/SCRIPTURE_CATALOG[^[]*\[([\s\S]*?)\];/);
if (!catalogMatch) {
  console.error('Could not find SCRIPTURE_CATALOG in data.ts');
  process.exit(1);
}

const catalogBlock = catalogMatch[1];

// Parse each entry
const entryRegex = /\{\s*part:\s*(\d+),\s*title:\s*'([^']*)',\s*subid:\s*(\d+),\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+)/g;
const entries = [];
let m;
while ((m = entryRegex.exec(catalogBlock)) !== null) {
  entries.push({
    part: parseInt(m[1]),
    title: m[2],
    subid: parseInt(m[3]),
    scrollCount: parseInt(m[4]),
    firstBookId: parseInt(m[5])
  });
}

console.log(`Parsed ${entries.length} catalog entries (parts ${entries[0].part} to ${entries[entries.length-1].part})\n`);

// Check sequencing
console.log('=== SEQUENCING ISSUES ===');
console.log('Rule: entry[i].firstBookId should equal entry[i-1].firstBookId + entry[i-1].scrollCount\n');

let issueCount = 0;
let cumulativeOffset = 0;

for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1];
  const curr = entries[i];
  const expected = prev.firstBookId + prev.scrollCount;
  
  if (curr.firstBookId !== expected) {
    const diff = curr.firstBookId - expected;
    cumulativeOffset += diff;
    issueCount++;
    console.log(`Part ${curr.part} (${curr.title}):`);
    console.log(`  Actual firstBookId:   ${curr.firstBookId}`);
    console.log(`  Expected firstBookId: ${expected}`);
    console.log(`  Difference:           ${diff > 0 ? '+' : ''}${diff} (${diff > 0 ? 'skipped IDs' : 'overlapping IDs'})`);
    console.log(`  Previous: part ${prev.part} (${prev.title}), firstBookId=${prev.firstBookId}, scrollCount=${prev.scrollCount}`);
    console.log(`  Cumulative offset:    ${cumulativeOffset > 0 ? '+' : ''}${cumulativeOffset}`);
    console.log();
  }
}

if (issueCount === 0) {
  console.log('No sequencing issues found.\n');
} else {
  console.log(`Total sequencing issues: ${issueCount}\n`);
}

// Check for duplicate firstBookId values
console.log('=== DUPLICATE firstBookId VALUES ===\n');
const bookIdMap = new Map();
for (const entry of entries) {
  if (!bookIdMap.has(entry.firstBookId)) {
    bookIdMap.set(entry.firstBookId, []);
  }
  bookIdMap.get(entry.firstBookId).push(entry);
}

let dupCount = 0;
for (const [bookId, dups] of bookIdMap) {
  if (dups.length > 1) {
    dupCount++;
    console.log(`firstBookId ${bookId} is used by ${dups.length} entries:`);
    for (const d of dups) {
      console.log(`  Part ${d.part}: ${d.title} (scrollCount=${d.scrollCount})`);
    }
    console.log();
  }
}

if (dupCount === 0) {
  console.log('No duplicate firstBookId values found.\n');
} else {
  console.log(`Total duplicate firstBookId groups: ${dupCount}\n`);
}

// Summary
console.log('=== SUMMARY ===');
console.log(`Total entries:          ${entries.length}`);
console.log(`Sequencing issues:      ${issueCount}`);
console.log(`Duplicate firstBookId:  ${dupCount}`);
console.log(`First entry: part ${entries[0].part}, firstBookId=${entries[0].firstBookId}`);
const last = entries[entries.length - 1];
console.log(`Last entry:  part ${last.part}, firstBookId=${last.firstBookId}, ends at bookId ${last.firstBookId + last.scrollCount - 1}`);
console.log(`Final cumulative offset: ${cumulativeOffset > 0 ? '+' : ''}${cumulativeOffset}`);
