const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data.ts');
const content = fs.readFileSync(dataPath, 'utf-8');
const lines = content.split('\n');

// Extract all SCRIPTURE_CATALOG entries with their line numbers and data
const entries = [];
const entryRegex = /\{\s*part:\s*(\d+),\s*title:\s*'[^']*',\s*subid:\s*\d+,\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+)/;

for (let i = 0; i < lines.length; i++) {
  const match = lines[i].match(entryRegex);
  if (match) {
    entries.push({
      lineIndex: i,
      line: lines[i],
      part: parseInt(match[1]),
      scrollCount: parseInt(match[2]),
      currentFirstBookId: parseInt(match[3]),
    });
  }
}

// Calculate correct firstBookId sequentially starting from 4031 for part 372
let expectedBookId = 4031;
const diffs = [];

for (const entry of entries) {
  if (entry.currentFirstBookId !== expectedBookId) {
    const newLine = entry.line.replace(
      /firstBookId:\s*\d+/,
      `firstBookId: ${expectedBookId}`
    );
    diffs.push({
      part: entry.part,
      oldBookId: entry.currentFirstBookId,
      newBookId: expectedBookId,
      oldLine: entry.line.trim(),
      newLine: newLine.trim(),
    });
  }
  expectedBookId += entry.scrollCount;
}

// Output
if (diffs.length === 0) {
  console.log('No differences found. All firstBookId values are correct.');
} else {
  console.log(`Found ${diffs.length} entries with incorrect firstBookId:\n`);
  console.log('For data.ts:');
  for (const d of diffs) {
    console.log(`${d.oldLine}|${d.newLine}`);
    console.log();
  }
}
