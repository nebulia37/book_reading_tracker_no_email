/**
 * Verify catalog subid mappings by fetching the page title from each subid
 * at the upstream site and comparing with our catalog title.
 *
 * The page title is in traditional Chinese, same as our catalog, so we can
 * compare directly without trad/simplified conversion issues.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCatalog() {
  const dataPath = path.join(__dirname, '..', 'data.ts');
  const src = fs.readFileSync(dataPath, 'utf-8');
  const entries = [];
  const lineRe = /part:\s*(\d+),\s*title:\s*\x27([^\x27]+)\x27,\s*subid:\s*(\d+),\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+),\s*collectionId:\s*(\d+)/g;
  let m;
  while ((m = lineRe.exec(src)) !== null) {
    entries.push({
      part: parseInt(m[1]),
      title: m[2],
      subid: parseInt(m[3]),
      scrollCount: parseInt(m[4]),
      firstBookId: parseInt(m[5]),
      collectionId: parseInt(m[6])
    });
  }
  return entries;
}

async function fetchPageTitle(collectionId, subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${collectionId}/subid/${subid}/`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const text = await resp.text();
    const titleMatch = text.match(/<title>([^<]*)<\/title>/);
    if (!titleMatch) return { title: null, partNum: null };
    const raw = titleMatch[1].trim();
    // Pattern: "第NNN部 TITLE" or just "TITLE"
    const partMatch = raw.match(/第(\d+)部\s+(.+)/);
    if (partMatch) {
      return { title: partMatch[2].trim(), partNum: parseInt(partMatch[1]) };
    }
    return { title: raw, partNum: null };
  } catch (err) {
    return { title: null, partNum: null, error: err.message };
  }
}

async function main() {
  const catalog = parseCatalog();
  // Filter to just collectionId 48 entries (parts 372-537)
  const entries48 = catalog.filter(e => e.collectionId === 48);
  console.log(`Found ${entries48.length} entries with collectionId 48 (parts ${entries48[0].part}-${entries48[entries48.length-1].part})\n`);

  const results = [];

  for (let i = 0; i < entries48.length; i++) {
    const entry = entries48[i];
    const { title: pageTitle, partNum, error } = await fetchPageTitle(entry.collectionId, entry.subid);

    const match = pageTitle && (
      pageTitle === entry.title ||
      pageTitle.includes(entry.title) ||
      entry.title.includes(pageTitle)
    );

    const result = {
      part: entry.part,
      catalogTitle: entry.title,
      subid: entry.subid,
      firstBookId: entry.firstBookId,
      scrollCount: entry.scrollCount,
      pageTitle,
      upstreamPartNum: partNum,
      match,
      error
    };
    results.push(result);

    if (match) {
      console.log(`[${i+1}/${entries48.length}] Part ${entry.part} (subid ${entry.subid}): OK - "${entry.title}"`);
    } else if (error) {
      console.log(`[${i+1}/${entries48.length}] Part ${entry.part} (subid ${entry.subid}): ERROR - ${error}`);
    } else {
      console.log(`[${i+1}/${entries48.length}] Part ${entry.part} (subid ${entry.subid}): MISMATCH`);
      console.log(`    Our title:      "${entry.title}"`);
      console.log(`    Upstream title:  "${pageTitle}" (Part ${partNum})`);
    }

    await sleep(200);
  }

  // Summary
  const matches = results.filter(r => r.match);
  const mismatches = results.filter(r => !r.match && !r.error);
  const errors = results.filter(r => r.error);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`SUMMARY: ${matches.length} OK, ${mismatches.length} MISMATCH, ${errors.length} ERRORS`);
  console.log(`${'='.repeat(80)}`);

  if (mismatches.length > 0) {
    console.log('\nMISMATCHED ENTRIES:');
    console.log('-'.repeat(80));
    for (const m of mismatches) {
      console.log(`Part ${m.part} (subid ${m.subid}, bookId ${m.firstBookId}):`);
      console.log(`  Our catalog:  "${m.catalogTitle}"`);
      console.log(`  Upstream:     "${m.pageTitle}" (upstream part ${m.upstreamPartNum})`);
    }

    // Try to detect the offset pattern
    console.log('\nOFFSET ANALYSIS:');
    console.log('-'.repeat(80));
    for (const m of mismatches) {
      if (m.upstreamPartNum !== null) {
        const offset = m.upstreamPartNum - m.part;
        console.log(`Part ${m.part}: upstream says Part ${m.upstreamPartNum} (offset: ${offset >= 0 ? '+' : ''}${offset})`);
      }
    }
  }

  // Save full results
  const outPath = path.join(__dirname, '..', 'subid_verify_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
