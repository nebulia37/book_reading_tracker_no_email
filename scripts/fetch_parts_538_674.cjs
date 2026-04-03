/**
 * Fetch catalog data for parts 538-674 (小乘阿含部, collection 47).
 * Subid pattern: subid = part + 93.
 * Collection 47 pages are GBK-encoded but scroll lists load via AJAX,
 * so we probe bookIds via the AJAX metadata endpoint.
 *
 * Merge rules (per user):
 *  - 0x prefix labels (0a, 0b) at start: merge all 0x labels + first numbered scroll
 *    e.g. ["0a","1","2"] → mergeFileCount=2, ["0a","0b","1"] → mergeFileCount=3
 *  - Trailing Xa/Xb labels sharing same base: merge into last scroll (trailingMergeCount)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const COLLECTION_ID = 47;
const PART_START = 538;
const PART_END = 674;
const BOOK_ID_START = 4415; // part 538 label 1
const BOOK_ID_END = 4800;   // generous upper bound (part 674 ends ~4793)
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probeBookId(bookId) {
  const resp = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: `menuid=${COLLECTION_ID}|631&book=${bookId}&lang=zh`
  });
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  try {
    const json = JSON.parse(iconv.decode(Buffer.from(buf), 'gbk'));
    const audio = json.links || json.audiolinks || '';
    const m = audio.match(/\/fojing\/\d+\/\d+\/(\d+)\/\d+_([^.]+)\.mp3/);
    return m ? { part: parseInt(m[1]), label: m[2] } : null;
  } catch { return null; }
}

async function fetchTitle(subid) {
  try {
    const resp = await fetch(`https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`);
    const html = await resp.text();
    const m = html.match(/第\d+部\s+([^<\n]+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

function analyzeLabels(scrollLabels) {
  // Detect leading 0x prefix merge
  let zeroCount = 0;
  for (const label of scrollLabels) {
    if (/^0[a-zA-Z]/i.test(label)) zeroCount++;
    else break;
  }
  const has0aPreface = zeroCount > 0;
  const mergeFileCount = has0aPreface ? zeroCount + 1 : undefined;

  // Detect trailing Xa/Xb merge
  let trailingMergeCount = 1;
  const n = scrollLabels.length;
  if (n >= 2) {
    const lastLabel = scrollLabels[n - 1];
    if (/\d+[a-z]$/i.test(lastLabel)) {
      const lastBase = lastLabel.match(/^(\d+)/)?.[1];
      if (lastBase) {
        let i = n - 2;
        while (i >= 0 && scrollLabels[i].match(/^(\d+)/)?.[1] === lastBase) {
          trailingMergeCount++;
          i--;
        }
        if (trailingMergeCount === 1) trailingMergeCount = 1; // reset if no match
      }
    }
  }

  return { has0aPreface, mergeFileCount, trailingMergeCount };
}

async function main() {
  console.log(`Probing bookIds ${BOOK_ID_START}–${BOOK_ID_END} for parts ${PART_START}–${PART_END}...`);
  const bookMap = {};

  for (let bookId = BOOK_ID_START; bookId <= BOOK_ID_END; bookId++) {
    const r = await probeBookId(bookId);
    if (r && r.part >= PART_START && r.part <= PART_END) {
      bookMap[bookId] = r;
      process.stdout.write(`bookId ${bookId} → part ${r.part} label ${r.label}\n`);
    } else if (r) {
      process.stdout.write(`bookId ${bookId} → part ${r.part} (outside range, stopping)\n`);
      if (r.part > PART_END) break;
    } else {
      process.stdout.write(`bookId ${bookId} → no audio\n`);
    }
    await sleep(120);
  }

  // Group by part
  const partGroups = {};
  for (const [id, info] of Object.entries(bookMap)) {
    if (!partGroups[info.part]) partGroups[info.part] = [];
    partGroups[info.part].push({ bookId: parseInt(id), label: info.label });
  }

  // Fetch titles (collection 47 pages are UTF-8 for the HTML text — test both)
  console.log('\nFetching titles...');
  const titles = {};
  for (let part = PART_START; part <= PART_END; part++) {
    titles[part] = await fetchTitle(part + 93);
    if (titles[part]) console.log(`Part ${part}: "${titles[part]}"`);
    await sleep(150);
  }

  // Build entries
  const entries = [];
  for (let part = PART_START; part <= PART_END; part++) {
    const subid = part + 93;
    const group = (partGroups[part] || []).sort((a, b) => a.bookId - b.bookId);
    if (!group.length) { console.log(`WARNING: no bookIds for part ${part}`); continue; }

    const bookIds = group.map(g => g.bookId);
    const scrollLabels = group.map(g => g.label + '卷');
    const firstBookId = bookIds[0];
    const rawScrollCount = bookIds.length;

    const { has0aPreface, mergeFileCount, trailingMergeCount } = analyzeLabels(scrollLabels);
    const leadReduction = has0aPreface ? (mergeFileCount - 1) : 0;
    const trailReduction = trailingMergeCount > 1 ? (trailingMergeCount - 1) : 0;
    const scrollCount = rawScrollCount - leadReduction - trailReduction;

    entries.push({ part, title: titles[part] || '', subid, rawScrollCount, scrollCount, firstBookId, collectionId: COLLECTION_ID, has0aPreface, mergeFileCount, trailingMergeCount, bookIds, scrollLabels });

    const flags = [];
    if (has0aPreface) flags.push(`has0aPreface mergeFileCount=${mergeFileCount}`);
    if (trailingMergeCount > 1) flags.push(`trailingMerge=${trailingMergeCount}`);
    console.log(`Part ${part}: raw=${rawScrollCount} effective=${scrollCount} ${flags.join(' ')}`);
    if (flags.length) console.log(`  labels: ${JSON.stringify(scrollLabels)}`);
  }

  fs.writeFileSync(path.join(__dirname, '..', 'parts_538_674_raw.json'), JSON.stringify(entries, null, 2), 'utf-8');

  console.log('\n=== CATALOG ENTRIES ===');
  for (const e of entries) {
    const flags = [];
    if (e.has0aPreface) flags.push(`has0aPreface: true`);
    if (e.mergeFileCount) flags.push(`mergeFileCount: ${e.mergeFileCount}`);
    if (e.trailingMergeCount > 1) flags.push(`trailingMergeCount: ${e.trailingMergeCount}`);
    // Store rawScrollCount for trailing-merge entries so server can compute bookIds
    const sc = e.trailingMergeCount > 1 ? e.rawScrollCount : e.scrollCount;
    const extra = flags.length ? ', ' + flags.join(', ') : '';
    console.log(`  { part: ${e.part}, title: '${e.title}', subid: ${e.subid}, scrollCount: ${sc}, firstBookId: ${e.firstBookId}, collectionId: ${COLLECTION_ID}${extra} },`);
  }
  console.log(`\nTotal effective scrolls: ${entries.reduce((s, e) => s + e.scrollCount, 0)}`);
  console.log('Done.');
}

main().catch(console.error);
