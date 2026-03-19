/**
 * Fetch catalog for parts 777-1076 from collection 51 (starting subid 884)
 * and apply the results directly to server.js and data.ts.
 *
 * Usage: node scripts/fetch_and_apply_777_1076.cjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const COLLECTION_ID = 51;
const PART_START = 777;
const PART_END = 1076;
const SUBID_START = 884;
const SUBID_SCAN_END = 1500; // generous upper bound

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Group bookIds by their label base number, then merge the "0x" preface group
 * into the immediately following non-"0" group.
 *
 * Examples:
 *   ["0a","1","2","3"]       → [[id0a,id1],[id2],[id3]]   (0a merges with 1)
 *   ["0a","0b","1"]          → [[id0a,id0b,id1]]           (0a+0b+1 all merge → 1 scroll)
 *   ["0a","0b","1","2","3"]  → [[id0a,id0b,id1],[id2],[id3]] (0a+0b merge with 1)
 *   ["1a","1b","2","3"]      → [[id1a,id1b],[id2],[id3]]   (1a+1b merge → scroll 1)
 *   ["1","2","3"]            → [[id1],[id2],[id3]]          (no merges)
 */
function computeBookIdGroups(bookIds, scrollLabels) {
  function getBaseNum(label) {
    const m = label.match(/^(\d+)/);
    return m ? parseInt(m[1]) : -1;
  }

  // Step 1: group consecutive labels sharing the same base number
  const baseGroups = [];
  for (let i = 0; i < bookIds.length; i++) {
    const base = getBaseNum(scrollLabels[i]);
    const last = baseGroups[baseGroups.length - 1];
    if (last && last.base === base) {
      last.ids.push(bookIds[i]);
    } else {
      baseGroups.push({ base, ids: [bookIds[i]] });
    }
  }

  // Step 2: merge "0" base group into the immediately following group
  // (0a/0b are preface files that always pair with the first real scroll)
  if (baseGroups.length >= 2 && baseGroups[0].base === 0) {
    const prefaceIds = baseGroups.shift().ids;
    baseGroups[0].ids = [...prefaceIds, ...baseGroups[0].ids];
  }

  return baseGroups.map(g => g.ids);
}

async function fetchPageInfo(subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    if (!titleMatch) return null;
    const raw = titleMatch[1].trim();
    const partMatch = raw.match(/第(\d+)部\s+(.+)/);

    // Extract bookIds from <li id="NNNN"><b>label</b>
    const bookIds = [];
    const scrollLabels = [];
    const liRegex = /<li[^>]*id="(\d+)"[^>]*><b>([^<]*)<\/b>/g;
    let lm;
    while ((lm = liRegex.exec(html)) !== null) {
      bookIds.push(parseInt(lm[1]));
      scrollLabels.push(lm[2]);
    }
    bookIds.sort((a, b) => a - b);

    if (partMatch) {
      return {
        partNum: parseInt(partMatch[1]),
        title: partMatch[2].trim(),
        subid,
        bookIds,
        scrollLabels,
        firstBookId: bookIds[0] || null,
        scrollCount: bookIds.length,
        bookIdGroups: computeBookIdGroups(bookIds, scrollLabels)
      };
    }
    return { partNum: null, title: raw, subid, bookIds, scrollLabels, firstBookId: null, scrollCount: 0, bookIdGroups: [] };
  } catch (err) {
    console.error(`  subid ${subid}: fetch error - ${err.message}`);
    return null;
  }
}

async function fetchAllParts() {
  console.log(`Fetching parts ${PART_START}-${PART_END} from collectionId ${COLLECTION_ID} (subids ${SUBID_START}+)...\n`);

  const entries = [];
  const foreignEntries = [];
  let consecutiveMisses = 0;

  for (let subid = SUBID_START; subid <= SUBID_SCAN_END; subid++) {
    const info = await fetchPageInfo(subid);

    if (!info || !info.partNum) {
      const label = info ? `"${info.title}" (no part num)` : 'null/error';
      console.log(`subid ${subid}: ${label} - SKIP`);
      if (info) foreignEntries.push({ subid, title: info.title });
      consecutiveMisses++;
      // If we already have enough parts and see many consecutive misses, stop
      if (entries.length >= (PART_END - PART_START + 1)) break;
      if (consecutiveMisses > 20) {
        console.log('Too many consecutive misses, stopping scan.');
        break;
      }
      await sleep(100);
      continue;
    }

    consecutiveMisses = 0;

    if (info.partNum >= PART_START && info.partNum <= PART_END) {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (${info.scrollCount} scrolls, firstBookId=${info.firstBookId}${info.has0a ? ', has0a' : ''})`);
      entries.push(info);
    } else if (info.partNum > PART_END) {
      console.log(`subid ${subid}: Part ${info.partNum} - past range ${PART_END}, stopping`);
      break;
    } else {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (out of target range)`);
    }

    if (entries.length >= (PART_END - PART_START + 1)) {
      console.log(`\nAll ${PART_END - PART_START + 1} parts found.`);
      break;
    }

    await sleep(150);
  }

  return { entries, foreignEntries };
}

function buildCatalogLines(entries, collectionId) {
  entries.sort((a, b) => a.partNum - b.partNum);
  return entries.map(p => {
    const groups = p.bookIdGroups;
    const groupsStr = JSON.stringify(groups);
    // Warn about any non-trivial merges so they're visible in the log
    const mergedScrolls = groups.filter(g => g.length > 1);
    if (mergedScrolls.length > 0) {
      console.log(`  [MERGE] Part ${p.partNum}: ${mergedScrolls.length} merged scroll(s): ${JSON.stringify(mergedScrolls)}`);
    }
    return `  { part: ${p.partNum}, title: '${p.title}', subid: ${p.subid}, collectionId: ${collectionId}, bookIdGroups: ${groupsStr} },`;
  });
}

function applyToServerJs(catalogLines, serverJsPath) {
  let src = fs.readFileSync(serverJsPath, 'utf-8');

  const startMarker = '// ============================================\n// CATALOG FOR PARTS';
  const endMarker = '];\nfunction getCatalogEntry(part)';

  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not find SCRIPTURE_CATALOG block in server.js');
  }

  const before = src.slice(0, startIdx);
  const after = src.slice(endIdx);

  const newBlock = [
    `// ============================================`,
    `// CATALOG FOR PARTS ${PART_START}-${PART_END} (collection ${COLLECTION_ID})`,
    `// ============================================`,
    `const SCRIPTURE_CATALOG = [`,
    ...catalogLines,
    `];`,
  ].join('\n');

  const newSrc = before + newBlock + '\n' + after;
  fs.writeFileSync(serverJsPath, newSrc, 'utf-8');
  console.log(`\nUpdated ${serverJsPath}`);
}

function applyToDataTs(entries, catalogLines, dataTsPath) {
  let src = fs.readFileSync(dataTsPath, 'utf-8');

  // Update comment block and SCRIPTURE_CATALOG array
  const catalogStart = src.indexOf('export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [');
  const catalogEnd = src.indexOf('];', catalogStart) + 2;
  if (catalogStart === -1 || catalogEnd === -1) {
    throw new Error('Could not find SCRIPTURE_CATALOG in data.ts');
  }

  const newCatalog = [
    `export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [`,
    ...catalogLines,
    `];`,
  ].join('\n');

  // Update the docblock comment just before the catalog
  const commentStart = src.lastIndexOf('/**', catalogStart);
  const commentEnd = src.indexOf('*/', commentStart) + 2;

  const newComment = [
    `/**`,
    ` * Scripture Catalog: Parts ${PART_START}-${PART_END}`,
    ` * Collection ID: ${COLLECTION_ID}`,
    ` * From xianmijingzang.com`,
    ` */`,
  ].join('\n');

  let newSrc = src;
  // Replace catalog array
  newSrc = newSrc.slice(0, catalogStart) + newCatalog + newSrc.slice(catalogEnd);
  // Replace comment
  const newCommentStart = newSrc.lastIndexOf('/**', newSrc.indexOf('export const SCRIPTURE_CATALOG'));
  const newCommentEnd = newSrc.indexOf('*/', newCommentStart) + 2;
  newSrc = newSrc.slice(0, newCommentStart) + newComment + newSrc.slice(newCommentEnd);

  // Update CATALOG_BASE_URL
  newSrc = newSrc.replace(
    /const CATALOG_BASE_URL = 'https:\/\/w1\.xianmijingzang\.com\/wap\/tripitaka\/id\/\d+\/subid\/';/,
    `const CATALOG_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/';`
  );

  fs.writeFileSync(dataTsPath, newSrc, 'utf-8');
  console.log(`Updated ${dataTsPath}`);
}

async function main() {
  const root = path.join(__dirname, '..');
  const serverJsPath = path.join(root, 'server.js');
  const dataTsPath = path.join(root, 'data.ts');

  const { entries, foreignEntries } = await fetchAllParts();

  console.log(`\n=== SUMMARY ===`);
  console.log(`Found: ${entries.length} parts`);
  console.log(`Skipped/foreign: ${foreignEntries.length}`);

  if (entries.length === 0) {
    console.error('No entries found. Aborting.');
    process.exit(1);
  }

  // Save raw JSON for reference
  const jsonPath = path.join(root, 'parts_777_1076_raw.json');
  fs.writeFileSync(jsonPath, JSON.stringify(entries, null, 2));
  console.log(`Raw data saved to ${jsonPath}`);

  const catalogLines = buildCatalogLines(entries, COLLECTION_ID);

  console.log('\n--- Catalog lines ---');
  catalogLines.forEach(l => console.log(l));

  applyToServerJs(catalogLines, serverJsPath);
  applyToDataTs(entries, catalogLines, dataTsPath);

  console.log('\nDone. Run: npm run build && npm start');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
