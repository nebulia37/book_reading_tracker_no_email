/**
 * Fetch catalog data for parts 83-108 (大乘华严部, collection 43).
 *
 * Strategy: probe each bookId via AJAX metadata endpoint to discover part/label.
 * Titles fetched with UTF-8 (collection 43 pages are UTF-8, unlike GBK-encoded coll 50/51).
 *
 * Merge rules (per user):
 *  - Labels sharing the same base number are merged into one scroll.
 *  - "0a","0b","1" → all merge into scroll 1 (mergeFileCount = number of 0x files + 1)
 *  - "40a","40b" at the end → merge into the last scroll (trailingMergeCount = 2)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const COLLECTION_ID = 43;
const BOOK_ID_START = 3100;
const BOOK_ID_END = 3420;
const PART_START = 83;
const PART_END = 108;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probeBookId(bookId, menuid) {
  const resp = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: `menuid=${menuid}&book=${bookId}&lang=zh`
  });
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  const text = iconv.decode(Buffer.from(buf), 'gbk');
  try { return JSON.parse(text); } catch { return null; }
}

function parseAudioUrl(audioUrl) {
  if (!audioUrl) return null;
  // Format: /fojing/1/X/PARTNUM/PARTNUM_LABEL.mp3
  const m = audioUrl.match(/\/fojing\/\d+\/\d+\/(\d+)\/\d+_([^.]+)\.mp3/);
  if (!m) return null;
  return { partNum: parseInt(m[1]), label: m[2] };
}

async function fetchTitle(subid) {
  // Collection 43 pages are UTF-8 — use resp.text() directly
  try {
    const resp = await fetch(`https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`);
    const html = await resp.text();
    const m = html.match(/第\d+部\s+([^<\n]+)/);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

async function main() {
  console.log(`Probing bookIds ${BOOK_ID_START}–${BOOK_ID_END}...`);
  const menuid = `${COLLECTION_ID}|152`;
  const bookMap = {};

  for (let bookId = BOOK_ID_START; bookId <= BOOK_ID_END; bookId++) {
    const data = await probeBookId(bookId, menuid);
    const audioUrl = data?.links || data?.audiolinks || '';
    const parsed = parseAudioUrl(audioUrl);
    if (parsed) {
      bookMap[bookId] = parsed;
      process.stdout.write(`bookId ${bookId} → part ${parsed.partNum} label ${parsed.label}\n`);
    } else {
      process.stdout.write(`bookId ${bookId} → no audio\n`);
    }
    await sleep(120);
  }

  // Group bookIds by partNum
  const partGroups = {};
  for (const [id, info] of Object.entries(bookMap)) {
    const p = info.partNum;
    if (!partGroups[p]) partGroups[p] = [];
    partGroups[p].push({ bookId: parseInt(id), label: info.label });
  }

  // Fetch titles (UTF-8)
  console.log('\nFetching titles...');
  const titles = {};
  for (let part = PART_START; part <= PART_END; part++) {
    titles[part] = await fetchTitle(part + 69);
    console.log(`Part ${part}: "${titles[part]}"`);
    await sleep(200);
  }

  // Build catalog entries
  const entries = [];
  for (let part = PART_START; part <= PART_END; part++) {
    const subid = part + 69;
    const group = (partGroups[part] || []).sort((a, b) => a.bookId - b.bookId);
    if (!group.length) { console.log(`WARNING: no bookIds for part ${part}`); continue; }

    const bookIds = group.map(g => g.bookId);
    const scrollLabels = group.map(g => g.label + '卷');
    const firstBookId = bookIds[0];
    const rawScrollCount = bookIds.length; // physical file count

    // --- Detect leading 0x prefix merge (has0aPreface) ---
    let zeroCount = 0;
    for (const label of scrollLabels) {
      if (/^0[a-zA-Z]/i.test(label)) zeroCount++;
      else break;
    }
    const has0aPreface = zeroCount > 0;
    // mergeFileCount = all 0x labels + first numbered scroll
    const mergeFileCount = has0aPreface ? zeroCount + 1 : undefined;

    // --- Detect trailing Xa/Xb merge (same base number at end) ---
    // Count how many trailing labels share the same base number
    let trailingMergeCount = 1;
    if (rawScrollCount >= 2) {
      const lastLabel = scrollLabels[rawScrollCount - 1];
      const lastBase = lastLabel.match(/^(\d+)/)?.[1];
      if (lastBase) {
        let i = rawScrollCount - 2;
        while (i >= 0 && scrollLabels[i].startsWith(lastBase) && /[a-z]/i.test(scrollLabels[i].replace(/卷$/, ''))) {
          trailingMergeCount++;
          i--;
        }
        // Only count as trailing merge if last label also has a letter suffix (e.g. "40b")
        if (!/[a-z]/i.test(lastLabel.replace(/卷$/, ''))) trailingMergeCount = 1;
      }
    }

    // Effective scroll count = raw - lead reduction - trail reduction
    const leadReduction = has0aPreface ? (mergeFileCount - 1) : 0;
    const trailReduction = trailingMergeCount > 1 ? (trailingMergeCount - 1) : 0;
    const scrollCount = rawScrollCount - leadReduction - trailReduction;

    entries.push({
      part, title: titles[part] || '', subid, rawScrollCount, scrollCount,
      firstBookId, collectionId: COLLECTION_ID,
      has0aPreface, mergeFileCount, trailingMergeCount,
      bookIds, scrollLabels
    });

    const flags = [];
    if (has0aPreface) flags.push(`has0aPreface (mergeFileCount=${mergeFileCount})`);
    if (trailingMergeCount > 1) flags.push(`trailingMerge=${trailingMergeCount}`);
    console.log(`Part ${part}: raw=${rawScrollCount} effective=${scrollCount} ${flags.join(' ')}`);
    console.log(`  labels: ${JSON.stringify(scrollLabels)}`);
  }

  // Save raw
  fs.writeFileSync(
    path.join(__dirname, '..', 'parts_83_108_raw.json'),
    JSON.stringify(entries, null, 2), 'utf-8'
  );

  // Print catalog lines
  console.log('\n=== CATALOG ENTRIES ===');
  for (const e of entries) {
    const flags = [];
    if (e.has0aPreface) flags.push(`has0aPreface: true`);
    if (e.mergeFileCount) flags.push(`mergeFileCount: ${e.mergeFileCount}`);
    if (e.trailingMergeCount > 1) flags.push(`trailingMergeCount: ${e.trailingMergeCount}`);
    // Note: for catalog we store rawScrollCount so the server can compute bookIds correctly
    const scrollCountField = e.trailingMergeCount > 1 ? e.rawScrollCount : e.scrollCount;
    const extra = flags.length ? ', ' + flags.join(', ') : '';
    console.log(`  { part: ${e.part}, title: '${e.title}', subid: ${e.subid}, scrollCount: ${scrollCountField}, firstBookId: ${e.firstBookId}, collectionId: ${COLLECTION_ID}${extra} },`);
  }
  console.log('\nDone.');
}

main().catch(console.error);
