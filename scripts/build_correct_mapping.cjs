/**
 * Build the correct part→subid mapping and fetch firstBookId/scrollCount
 * for each part from the upstream site. Then apply corrections to data.ts and server.js.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The verified correct subid→part mapping from upstream:
// Based on verification results + extended checks
// subid 484 = Part 20 (foreign, skip)
// subid 486 = Part 42 (foreign, skip)
// subid 573 = Part 478 (duplicate, skip)
// subid 633 = Part 467 (moved to end)
// Part 467 upstream title = "佛說甚深大廻向經" (different from our "佛說孝子經")

// Build the correct part→subid map
function buildCorrectSubidMap() {
  const map = {};

  // Parts 372-390: subids 465-483 (unchanged, verified correct)
  for (let i = 0; i <= 18; i++) {
    map[372 + i] = 465 + i;
  }

  // From subid 484 onward, skip foreign entries at 484, 486
  // subid 485 = Part 391
  // subid 487 = Part 392
  // subid 488 = Part 393, 489 = Part 394, ..., 561 = Part 466
  map[391] = 485;
  let subid = 487;
  for (let part = 392; part <= 466; part++) {
    map[part] = subid;
    subid++;
  }
  // Now subid = 562
  // Part 467 is at subid 633 (moved to end, with different title)
  map[467] = 633;

  // subid 562 = Part 468, 563 = Part 469, ..., 572 = Part 478
  for (let part = 468; part <= 478; part++) {
    map[part] = subid;
    subid++;
  }
  // Now subid = 573, but 573 is duplicate of Part 478, skip it
  subid = 574; // skip 573

  // subid 574 = Part 479, 575 = Part 480, ..., 632 = Part 537
  for (let part = 479; part <= 537; part++) {
    map[part] = subid;
    subid++;
  }
  // Final subid should be 632 for part 537: 574 + (537-479) = 574 + 58 = 632 ✓

  return map;
}

async function fetchBookList(collectionId, subid) {
  // Fetch the page to get the list of books (scrolls) for this subid
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${collectionId}/subid/${subid}/`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    let title = null;
    let partNum = null;
    if (titleMatch) {
      const raw = titleMatch[1].trim();
      const pm = raw.match(/第(\d+)部\s+(.+)/);
      if (pm) { partNum = parseInt(pm[1]); title = pm[2].trim(); }
      else { title = raw; }
    }

    // Extract book IDs from the page
    // Look for patterns like: book_id=NNNN or data-book="NNNN" or similar
    const bookIds = [];

    // Pattern 1: links with book parameter
    const bookRegex = /book[_=](\d{4,})/g;
    let bm;
    while ((bm = bookRegex.exec(html)) !== null) {
      const id = parseInt(bm[1]);
      if (!bookIds.includes(id)) bookIds.push(id);
    }

    // Pattern 2: Look for scroll/volume links
    // The page typically has links like /wap/tripitaka/id/48/subid/XXX?book=NNNN
    const scrollRegex = /subid\/\d+\?book=(\d+)/g;
    while ((bm = scrollRegex.exec(html)) !== null) {
      const id = parseInt(bm[1]);
      if (!bookIds.includes(id)) bookIds.push(id);
    }

    // Pattern 3: data attributes
    const dataRegex = /data-book[id]*[="](\d{4,})/g;
    while ((bm = dataRegex.exec(html)) !== null) {
      const id = parseInt(bm[1]);
      if (!bookIds.includes(id)) bookIds.push(id);
    }

    bookIds.sort((a, b) => a - b);

    return { title, partNum, bookIds, scrollCount: bookIds.length };
  } catch (err) {
    return { title: null, partNum: null, bookIds: [], scrollCount: 0, error: err.message };
  }
}

function parseCatalog(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const entries = [];
  const lineRe = /\{\s*part:\s*(\d+),\s*title:\s*'([^']+)',\s*subid:\s*(\d+),\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+),\s*collectionId:\s*(\d+)([^}]*)\}/g;
  let m;
  while ((m = lineRe.exec(src)) !== null) {
    entries.push({
      part: parseInt(m[1]),
      title: m[2],
      subid: parseInt(m[3]),
      scrollCount: parseInt(m[4]),
      firstBookId: parseInt(m[5]),
      collectionId: parseInt(m[6]),
      extra: m[7].trim() // preserve has0aPreface etc.
    });
  }
  return entries;
}

async function main() {
  const correctSubids = buildCorrectSubidMap();

  console.log('Correct subid mapping built for parts 372-537');
  console.log(`Part 391 → subid ${correctSubids[391]}`);
  console.log(`Part 467 → subid ${correctSubids[467]}`);
  console.log(`Part 537 → subid ${correctSubids[537]}`);

  // Fetch book lists for all corrected subids to get firstBookId and scrollCount
  const dataPath = path.join(__dirname, '..', 'data.ts');
  const catalog = parseCatalog(dataPath).filter(e => e.collectionId === 48);

  console.log(`\nFetching book data for ${catalog.length} entries...`);

  const corrections = [];

  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    const correctSubid = correctSubids[entry.part];

    if (!correctSubid) {
      console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: NO CORRECT SUBID FOUND`);
      continue;
    }

    const info = await fetchBookList(entry.collectionId, correctSubid);

    const subidChanged = correctSubid !== entry.subid;
    const bookIdChanged = info.bookIds.length > 0 && info.bookIds[0] !== entry.firstBookId;
    const scrollChanged = info.scrollCount > 0 && info.scrollCount !== entry.scrollCount;

    const correction = {
      part: entry.part,
      oldSubid: entry.subid,
      newSubid: correctSubid,
      oldFirstBookId: entry.firstBookId,
      newFirstBookId: info.bookIds.length > 0 ? info.bookIds[0] : entry.firstBookId,
      oldScrollCount: entry.scrollCount,
      newScrollCount: info.scrollCount > 0 ? info.scrollCount : entry.scrollCount,
      upstreamTitle: info.title,
      catalogTitle: entry.title,
      allBookIds: info.bookIds,
      changed: subidChanged || bookIdChanged || scrollChanged
    };

    corrections.push(correction);

    if (correction.changed) {
      const changes = [];
      if (subidChanged) changes.push(`subid: ${entry.subid}→${correctSubid}`);
      if (bookIdChanged) changes.push(`bookId: ${entry.firstBookId}→${info.bookIds[0]}`);
      if (scrollChanged) changes.push(`scrollCount: ${entry.scrollCount}→${info.scrollCount}`);
      console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: ${changes.join(', ')} (upstream: "${info.title}")`);
    } else {
      console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: OK`);
    }

    await sleep(200);
  }

  // Save corrections
  const outPath = path.join(__dirname, '..', 'corrections.json');
  fs.writeFileSync(outPath, JSON.stringify(corrections, null, 2));
  console.log(`\nCorrections saved to ${outPath}`);

  // Summary
  const changed = corrections.filter(c => c.changed);
  console.log(`\nSUMMARY: ${changed.length} entries need corrections out of ${corrections.length}`);

  // Now apply corrections to data.ts and server.js
  if (changed.length > 0) {
    console.log('\nApplying corrections to data.ts and server.js...');
    applyCorrections(corrections);
    console.log('Done!');
  }
}

function applyCorrections(corrections) {
  const files = [
    path.join(__dirname, '..', 'data.ts'),
    path.join(__dirname, '..', 'server.js')
  ];

  for (const filePath of files) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let changeCount = 0;

    for (const c of corrections) {
      if (!c.changed) continue;

      // Build regex to find the exact line for this part
      // Match the full entry line
      const escTitle = c.catalogTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        `(\\{\\s*part:\\s*${c.part},\\s*title:\\s*'${escTitle}',\\s*subid:\\s*)${c.oldSubid}(,\\s*scrollCount:\\s*)${c.oldScrollCount}(,\\s*firstBookId:\\s*)${c.oldFirstBookId}`,
        'g'
      );

      const newContent = content.replace(pattern, `$1${c.newSubid}$2${c.newScrollCount}$3${c.newFirstBookId}`);
      if (newContent !== content) {
        changeCount++;
        content = newContent;
      }
    }

    // Also fix Part 467 title if needed
    const part467 = corrections.find(c => c.part === 467);
    if (part467 && part467.upstreamTitle && part467.upstreamTitle !== part467.catalogTitle) {
      content = content.replace(
        new RegExp(`(part:\\s*467,\\s*title:\\s*')${part467.catalogTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(')`),
        `$1${part467.upstreamTitle}$2`
      );
      console.log(`  Updated Part 467 title to "${part467.upstreamTitle}" in ${path.basename(filePath)}`);
    }

    fs.writeFileSync(filePath, content);
    console.log(`  Applied ${changeCount} corrections to ${path.basename(filePath)}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
