const fs = require('fs');
const path = require('path');

const DATA_TS = path.resolve(__dirname, '..', 'data.ts');
const SERVER_JS = path.resolve(__dirname, '..', 'server.js');

// Step 1: Parse the catalog from data.ts to get part numbers and scrollCounts
function parseCatalog(content) {
  const entries = [];
  const regex = /\{\s*part:\s*(\d+),.*?scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    entries.push({
      part: parseInt(match[1]),
      scrollCount: parseInt(match[2]),
      currentFirstBookId: parseInt(match[3]),
    });
  }
  return entries;
}

// Step 2: Calculate the correct firstBookId values
function calculateCorrectIds(entries) {
  const corrections = new Map(); // part -> correctFirstBookId
  let nextId = 4031; // Part 372 starts at 4031

  for (const entry of entries) {
    corrections.set(entry.part, nextId);
    nextId += entry.scrollCount;
  }
  return corrections;
}

// Step 3: Apply fixes to a file
function applyFixes(filePath, corrections) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let fixCount = 0;

  // Replace firstBookId values on lines that contain "{ part:"
  const lines = content.split('\n');
  const fixedLines = lines.map(line => {
    // Only modify lines that are part of the SCRIPTURE_CATALOG (contain "{ part:")
    if (!line.includes('{ part:') && !line.includes('{part:')) return line;

    const partMatch = line.match(/part:\s*(\d+)/);
    if (!partMatch) return line;

    const part = parseInt(partMatch[1]);
    const correctId = corrections.get(part);
    if (correctId === undefined) return line;

    const bookIdMatch = line.match(/firstBookId:\s*(\d+)/);
    if (!bookIdMatch) return line;

    const currentId = parseInt(bookIdMatch[1]);
    if (currentId === correctId) return line;

    fixCount++;
    console.log('  Part ' + part + ': firstBookId ' + currentId + ' -> ' + correctId);
    return line.replace(/firstBookId:\s*\d+/, 'firstBookId: ' + correctId);
  });

  const fixedContent = fixedLines.join('\n');
  fs.writeFileSync(filePath, fixedContent, 'utf-8');
  return fixCount;
}

// Step 4: Verify the corrections
function verify(filePath, corrections) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries = parseCatalog(content);
  let errors = 0;

  for (const entry of entries) {
    const expected = corrections.get(entry.part);
    if (expected === undefined) continue;
    if (entry.currentFirstBookId !== expected) {
      console.log('  VERIFICATION FAILED: Part ' + entry.part + ' has firstBookId ' + entry.currentFirstBookId + ', expected ' + expected);
      errors++;
    }
  }

  // Also verify sequential rule
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const expectedFromPrev = prev.currentFirstBookId + prev.scrollCount;
    if (curr.currentFirstBookId !== expectedFromPrev) {
      console.log('  SEQUENCE ERROR: Part ' + curr.part + ' has firstBookId ' + curr.currentFirstBookId + ', expected ' + expectedFromPrev + ' (prev part ' + prev.part + ': ' + prev.currentFirstBookId + ' + ' + prev.scrollCount + ')');
      errors++;
    }
  }

  return errors;
}

// Main
console.log('=== Reading catalog from data.ts ===');
const dataContent = fs.readFileSync(DATA_TS, 'utf-8');
const entries = parseCatalog(dataContent);
console.log('Found ' + entries.length + ' catalog entries (parts ' + entries[0].part + ' to ' + entries[entries.length - 1].part + ')');

console.log('\n=== Calculating correct firstBookId values ===');
const corrections = calculateCorrectIds(entries);
console.log('Calculated corrections for ' + corrections.size + ' entries');

// Show which ones need fixing
let needsFix = 0;
for (const entry of entries) {
  const correct = corrections.get(entry.part);
  if (entry.currentFirstBookId !== correct) {
    needsFix++;
  }
}
console.log(needsFix + ' entries need correction');

console.log('\n=== Fixing data.ts ===');
const dataFixes = applyFixes(DATA_TS, corrections);
console.log('Applied ' + dataFixes + ' fixes to data.ts');

console.log('\n=== Fixing server.js ===');
const serverFixes = applyFixes(SERVER_JS, corrections);
console.log('Applied ' + serverFixes + ' fixes to server.js');

console.log('\n=== Verifying data.ts ===');
const dataErrors = verify(DATA_TS, corrections);
if (dataErrors === 0) {
  console.log('  data.ts: ALL CORRECT');
} else {
  console.log('  data.ts: ' + dataErrors + ' errors found!');
}

console.log('\n=== Verifying server.js ===');
const serverErrors = verify(SERVER_JS, corrections);
if (serverErrors === 0) {
  console.log('  server.js: ALL CORRECT');
} else {
  console.log('  server.js: ' + serverErrors + ' errors found!');
}

const totalErrors = dataErrors + serverErrors;
if (totalErrors === 0) {
  console.log('\n=== SUCCESS: All firstBookId values are correct in both files ===');
} else {
  console.log('\n=== FAILURE: ' + totalErrors + ' errors remain ===');
  process.exit(1);
}
