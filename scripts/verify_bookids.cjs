/**
 * Verify firstBookId and scrollCount for all parts 372-537 by fetching
 * the upstream page and extracting book IDs from <li id="NNNN"> elements.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCatalog() {
  const dataPath = path.join(__dirname, '..', 'data.ts');
  const src = fs.readFileSync(dataPath, 'utf-8');
  const entries = [];
  const lineRe = /\{\s*part:\s*(\d+),\s*title:\s*\x27([^\x27]+)\x27,\s*subid:\s*(\d+),\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+),\s*collectionId:\s*(\d+)([^}]*)\}/g;
  let m;
  while ((m = lineRe.exec(src)) !== null) {
    const extra = m[7].trim();
    entries.push({
      part: parseInt(m[1]),
      title: m[2],
      subid: parseInt(m[3]),
      scrollCount: parseInt(m[4]),
      firstBookId: parseInt(m[5]),
      collectionId: parseInt(m[6]),
      has0aPreface: extra.includes('has0aPreface: true')
    });
  }
  return entries;
}

async function fetchBookIds(collectionId, subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${collectionId}/subid/${subid}/`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await resp.text();

  // Extract book IDs from <li id="NNNN"> pattern
  const bookIds = [];
  const scrollLabels = [];
  const liRegex = /<li[^>]*id="(\d+)"[^>]*><b>([^<]*)<\/b>/g;
  let lm;
  while ((lm = liRegex.exec(html)) !== null) {
    bookIds.push(parseInt(lm[1]));
    scrollLabels.push(lm[2]);
  }

  // Also try alternate pattern: <li id="NNNN">
  if (bookIds.length === 0) {
    const altRegex = /<li[^>]*id="(\d{4,})"[^>]*>/g;
    while ((lm = altRegex.exec(html)) !== null) {
      const id = parseInt(lm[1]);
      if (!bookIds.includes(id)) bookIds.push(id);
    }
  }

  bookIds.sort((a, b) => a - b);

  return { bookIds, scrollLabels };
}

async function main() {
  const catalog = parseCatalog().filter(e => e.collectionId === 48);
  console.log(`Checking ${catalog.length} entries for correct firstBookId and scrollCount...\n`);

  const mismatches = [];

  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    try {
      const { bookIds, scrollLabels } = await fetchBookIds(entry.collectionId, entry.subid);

      if (bookIds.length === 0) {
        console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: NO BOOKS FOUND`);
        mismatches.push({
          part: entry.part,
          title: entry.title,
          subid: entry.subid,
          issue: 'NO_BOOKS_FOUND',
          catalogFirstBookId: entry.firstBookId,
          catalogScrollCount: entry.scrollCount,
          has0aPreface: entry.has0aPreface,
          upstreamBookIds: [],
          upstreamLabels: []
        });
        await sleep(200);
        continue;
      }

      const upstreamFirstBookId = bookIds[0];
      const upstreamScrollCount = bookIds.length;
      const has0a = scrollLabels.length > 0 && scrollLabels[0].includes('0a');

      const firstBookIdOk = entry.firstBookId === upstreamFirstBookId;
      const scrollCountOk = entry.scrollCount === upstreamScrollCount;
      const prefaceOk = has0a === entry.has0aPreface;

      if (firstBookIdOk && scrollCountOk && prefaceOk) {
        console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: OK (${upstreamScrollCount} scrolls, firstBookId=${upstreamFirstBookId}${has0a ? ', has0a' : ''})`);
      } else {
        const issues = [];
        if (!firstBookIdOk) issues.push(`firstBookId: ${entry.firstBookId}→${upstreamFirstBookId}`);
        if (!scrollCountOk) issues.push(`scrollCount: ${entry.scrollCount}→${upstreamScrollCount}`);
        if (!prefaceOk) issues.push(`has0aPreface: ${entry.has0aPreface}→${has0a}`);
        console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: MISMATCH - ${issues.join(', ')} [labels: ${scrollLabels.join(',')}]`);

        mismatches.push({
          part: entry.part,
          title: entry.title,
          subid: entry.subid,
          issue: 'MISMATCH',
          catalogFirstBookId: entry.firstBookId,
          upstreamFirstBookId,
          catalogScrollCount: entry.scrollCount,
          upstreamScrollCount,
          catalogHas0a: entry.has0aPreface,
          upstreamHas0a: has0a,
          upstreamBookIds: bookIds,
          upstreamLabels: scrollLabels
        });
      }
    } catch (err) {
      console.log(`[${i+1}/${catalog.length}] Part ${entry.part}: ERROR - ${err.message}`);
      mismatches.push({
        part: entry.part,
        title: entry.title,
        subid: entry.subid,
        issue: 'ERROR',
        error: err.message
      });
    }

    await sleep(200);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`SUMMARY: ${catalog.length - mismatches.length} OK, ${mismatches.length} issues`);
  console.log(`${'='.repeat(80)}`);

  if (mismatches.length > 0) {
    console.log('\nMISMATCHES:');
    for (const m of mismatches) {
      if (m.issue === 'MISMATCH') {
        console.log(`  Part ${m.part} "${m.title}":`);
        if (m.catalogFirstBookId !== m.upstreamFirstBookId)
          console.log(`    firstBookId: ${m.catalogFirstBookId} → ${m.upstreamFirstBookId}`);
        if (m.catalogScrollCount !== m.upstreamScrollCount)
          console.log(`    scrollCount: ${m.catalogScrollCount} → ${m.upstreamScrollCount}`);
        if (m.catalogHas0a !== m.upstreamHas0a)
          console.log(`    has0aPreface: ${m.catalogHas0a} → ${m.upstreamHas0a}`);
        console.log(`    bookIds: [${m.upstreamBookIds.join(', ')}]`);
        console.log(`    labels: [${m.upstreamLabels.join(', ')}]`);
      }
    }
  }

  const outPath = path.join(__dirname, '..', 'bookid_verify_results.json');
  fs.writeFileSync(outPath, JSON.stringify(mismatches, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
