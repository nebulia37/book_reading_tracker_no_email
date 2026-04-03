/**
 * Extend the probe: find bookIds for audioParts 675-690 (website parts 661-674+).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const COLLECTION_ID = 47;
const AUDIO_PART_START = 675;
const AUDIO_PART_END = 695;
const BOOK_ID_START = 4793;
const BOOK_ID_END = 4900;

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

async function main() {
  console.log(`Probing bookIds ${BOOK_ID_START}-${BOOK_ID_END} for audioParts ${AUDIO_PART_START}-${AUDIO_PART_END}...`);
  const bookMap = {};

  for (let bookId = BOOK_ID_START; bookId <= BOOK_ID_END; bookId++) {
    const r = await probeBookId(bookId);
    if (r && r.part >= AUDIO_PART_START && r.part <= AUDIO_PART_END) {
      if (!bookMap[r.part]) bookMap[r.part] = [];
      bookMap[r.part].push({ bookId, label: r.label });
      process.stdout.write(`bookId ${bookId} → audioPart ${r.part} label ${r.label}\n`);
    } else if (r) {
      process.stdout.write(`bookId ${bookId} → audioPart ${r.part} (outside)\n`);
      if (r.part > AUDIO_PART_END) break;
    } else {
      process.stdout.write(`bookId ${bookId} → no audio\n`);
    }
    await sleep(120);
  }

  // Merge with existing raw data
  const existingPath = path.join(__dirname, '..', 'parts_538_674_raw.json');
  const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));

  function analyzeLabels(scrollLabels) {
    let zeroCount = 0;
    for (const label of scrollLabels) {
      if (/^0[a-zA-Z]/i.test(label)) zeroCount++;
      else break;
    }
    const has0aPreface = zeroCount > 0;
    const mergeFileCount = has0aPreface ? zeroCount + 1 : undefined;
    let trailingMergeCount = 1;
    const n = scrollLabels.length;
    if (n >= 2) {
      const last = scrollLabels[n-1];
      if (/\d+[a-z]$/i.test(last)) {
        const base = last.match(/^(\d+)/)?.[1];
        if (base) {
          let i = n-2;
          while (i >= 0 && scrollLabels[i].match(/^(\d+)/)?.[1] === base) { trailingMergeCount++; i--; }
          if (trailingMergeCount === 1) trailingMergeCount = 1;
        }
      }
    }
    return { has0aPreface, mergeFileCount, trailingMergeCount };
  }

  for (const [partStr, items] of Object.entries(bookMap)) {
    const audioPart = parseInt(partStr);
    items.sort((a, b) => a.bookId - b.bookId);
    const bookIds = items.map(i => i.bookId);
    const scrollLabels = items.map(i => i.label + '卷');
    const rawScrollCount = bookIds.length;
    const { has0aPreface, mergeFileCount, trailingMergeCount } = analyzeLabels(scrollLabels);
    const leadReduction = has0aPreface ? (mergeFileCount - 1) : 0;
    const trailReduction = trailingMergeCount > 1 ? (trailingMergeCount - 1) : 0;
    const scrollCount = rawScrollCount - leadReduction - trailReduction;

    existing.push({
      part: audioPart, title: '', subid: audioPart + 93,
      rawScrollCount, scrollCount, firstBookId: bookIds[0],
      collectionId: 47, has0aPreface, mergeFileCount, trailingMergeCount,
      bookIds, scrollLabels
    });
    console.log(`Added audioPart ${audioPart}: raw=${rawScrollCount}, firstBookId=${bookIds[0]}`);
  }

  existing.sort((a, b) => a.part - b.part);
  fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`\nUpdated raw data with ${Object.keys(bookMap).length} new entries. Total: ${existing.length}`);
  console.log('Now re-run: node scripts/fetch_parts_538_674_coll49.cjs');
}

main().catch(console.error);
