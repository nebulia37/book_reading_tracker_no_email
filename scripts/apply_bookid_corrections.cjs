/**
 * Apply firstBookId, scrollCount, and has0aPreface corrections
 * based on bookid_verify_results.json to data.ts and server.js
 */
const fs = require('fs');
const path = require('path');

function main() {
  const resultsPath = path.join(__dirname, '..', 'bookid_verify_results.json');
  const mismatches = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  console.log(`Loaded ${mismatches.length} mismatches to fix`);

  const files = [
    path.join(__dirname, '..', 'data.ts'),
    path.join(__dirname, '..', 'server.js')
  ];

  for (const filePath of files) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let changeCount = 0;

    for (const m of mismatches) {
      if (m.issue !== 'MISMATCH') continue;

      const part = m.part;
      const oldFirstBookId = m.catalogFirstBookId;
      const newFirstBookId = m.upstreamFirstBookId;
      const oldScrollCount = m.catalogScrollCount;
      const newScrollCount = m.upstreamScrollCount;
      const needsPreface = m.upstreamHas0a && !m.catalogHas0a;

      // Build a regex to match the catalog entry for this part
      const escTitle = m.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Match the full entry: { part: NNN, title: 'XXX', subid: NNN, scrollCount: NNN, firstBookId: NNN, collectionId: NN ... }
      const pattern = new RegExp(
        `(\\{\\s*part:\\s*${part},\\s*title:\\s*'${escTitle}',\\s*subid:\\s*\\d+,\\s*scrollCount:\\s*)${oldScrollCount}(,\\s*firstBookId:\\s*)${oldFirstBookId}(,\\s*collectionId:\\s*48)([^}]*)\\}`
      );

      const match = content.match(pattern);
      if (!match) {
        console.log(`  WARNING: Could not find entry for Part ${part} in ${path.basename(filePath)}`);
        continue;
      }

      let extra = match[4];
      // Add has0aPreface if needed
      if (needsPreface && !extra.includes('has0aPreface')) {
        extra = extra + ', has0aPreface: true';
      }

      const replacement = `${match[1]}${newScrollCount}${match[2]}${newFirstBookId}${match[3]}${extra} }`;
      content = content.replace(pattern, replacement);
      changeCount++;
    }

    fs.writeFileSync(filePath, content);
    console.log(`Applied ${changeCount} corrections to ${path.basename(filePath)}`);
  }
}

main();
