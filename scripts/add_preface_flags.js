// Script to add has0aPreface: true to specific parts in data.ts and server.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parts that have 0a prefaces (or 1a/1b for part 312)
const partsWithPreface = [
  122, 123, 126, 127, 128, 129, 130, 133, 135, 137,
  155, 166, 173, 192, 194, 199, 206, 242, 303, 310,
  312, 314, 316, 345, 348, 359
];

function addPrefaceFlags(filePath) {
  console.log(`Processing ${path.basename(filePath)}...`);
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;

  partsWithPreface.forEach(part => {
    // Match the line for this part (handle both with and without existing has0aPreface)
    const regex = new RegExp(
      `(\\{ part: ${part}, [^}]+collectionId: 47)( },?)$`,
      'gm'
    );

    content = content.replace(regex, (match, p1, p2) => {
      // Only add if not already present
      if (!match.includes('has0aPreface')) {
        changes++;
        return `${p1}, has0aPreface: true${p2}`;
      }
      return match;
    });
  });

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ✓ Added has0aPreface to ${changes} parts`);
}

// Process both files
const dataPath = path.join(__dirname, '..', 'data.ts');
const serverPath = path.join(__dirname, '..', 'server.js');

addPrefaceFlags(dataPath);
addPrefaceFlags(serverPath);

console.log('\n✅ Done! All preface flags added.');
