/**
 * Fetch catalog for parts 538-674 from collection 49 (小乘阿含部).
 * Strategy: scan subids starting from 634 (first entry = 第538部 中阿含經),
 * fetch each page to get part number + title, probe bookIds via AJAX.
 *
 * Collection 49 offset varies (96 near start, 107 later) due to anomalous subids,
 * so we scan by subid and filter by the part number extracted from the page.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const COLLECTION_ID = 49;
const PART_START = 538;
const PART_END = 674;
const SUBID_START = 634; // first subid = 第538部
const SUBID_SCAN_END = 900; // generous upper bound
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPageInfo(subid) {
  try {
    const resp = await fetch(`https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buf);
    const m = html.match(/第(\d+)部\s+([^<\n"]+)/);
    if (!m) return null;
    const partNum = parseInt(m[1]);
    const title = m[2].trim();
    return { partNum, title, subid };
  } catch { return null; }
}

async function probeBookIds(subid, partNum) {
  // Use AJAX endpoint to find bookIds for this part
  const menuid = `${COLLECTION_ID}|${subid}`;
  const bookIds = [];
  const scrollLabels = [];

  // Start from a rough estimate based on previously known firstBookIds
  // Part 538(中阿含) ~4576. We scan a window of known-good ranges.
  // Instead, probe from the existing raw data (collection 47 probe gave us the bookIds already).
  // We'll re-use those bookIds — the audio files are the same regardless of collection.
  return null; // signal to re-use existing bookId data
}

// Load existing raw data from collection 47 probe
function loadExistingData() {
  const jsonPath = path.join(__dirname, '..', 'parts_538_674_raw.json');
  if (!fs.existsSync(jsonPath)) return {};
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  // Index by part number (audio PARTNUM from coll47 probe)
  const byAudioPart = {};
  for (const e of data) byAudioPart[e.part] = e;
  return byAudioPart;
}

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
    const lastLabel = scrollLabels[n - 1];
    if (/\d+[a-z]$/i.test(lastLabel)) {
      const lastBase = lastLabel.match(/^(\d+)/)?.[1];
      if (lastBase) {
        let i = n - 2;
        while (i >= 0 && scrollLabels[i].match(/^(\d+)/)?.[1] === lastBase) {
          trailingMergeCount++;
          i--;
        }
        if (trailingMergeCount === 1) trailingMergeCount = 1;
      }
    }
  }
  return { has0aPreface, mergeFileCount, trailingMergeCount };
}

async function main() {
  console.log(`Scanning collection ${COLLECTION_ID} subids ${SUBID_START}+ for parts ${PART_START}-${PART_END}...\n`);

  const existingByAudioPart = loadExistingData();
  console.log(`Loaded ${Object.keys(existingByAudioPart).length} entries from existing raw data.\n`);

  // Step 1: Scan pages to find subid → (partNum, title) mapping
  const pageMap = {}; // partNum → { subid, title }
  let consecutiveMisses = 0;
  let found = 0;

  for (let subid = SUBID_START; subid <= SUBID_SCAN_END; subid++) {
    const info = await fetchPageInfo(subid);
    if (!info) {
      process.stdout.write(`subid ${subid}: no info\n`);
      consecutiveMisses++;
      if (consecutiveMisses > 30) { console.log('Too many misses, stopping.'); break; }
      await sleep(100);
      continue;
    }
    consecutiveMisses = 0;

    if (info.partNum >= PART_START && info.partNum <= PART_END) {
      if (!pageMap[info.partNum]) {
        pageMap[info.partNum] = { subid, title: info.title };
        process.stdout.write(`subid ${subid}: part=${info.partNum} "${info.title}"\n`);
        found++;
      }
    } else {
      process.stdout.write(`subid ${subid}: part=${info.partNum} "${info.title}" (outside range)\n`);
    }

    if (found >= PART_END - PART_START + 1) {
      console.log('\nAll parts found!');
      break;
    }
    await sleep(150);
  }

  console.log(`\nFound ${Object.keys(pageMap).length} parts in range.`);

  // Step 2: For each part, find the matching bookId data from existing probe
  // The existing probe mapped audio PARTNUMs to bookIds.
  // Audio PARTNUM = website part + offset (varies).
  // We need to find which audio PARTNUM corresponds to each website part.
  //
  // Since audio file `/fojing/1/X/AP/AP_LABEL.mp3` uses AP = audio PARTNUM,
  // and the existing probe found AP→bookIds, we need AP = website_part + offset.
  //
  // From observed data: audio 541 = website 538 (offset=3), and the pattern shows
  // the offset increases at anomalous subids. We'll probe each website part's AJAX
  // to directly get its bookIds using the correct menuid.

  const entries = [];

  for (const [partNumStr, pageInfo] of Object.entries(pageMap).sort((a,b)=>parseInt(a)-parseInt(b))) {
    const partNum = parseInt(partNumStr);
    const { subid, title } = pageInfo;
    const menuid = `${COLLECTION_ID}|${subid}`;

    // Probe AJAX for bookIds of this part
    const bookIds = [];
    const scrollLabels = [];

    // Scan a range of bookIds via AJAX. We know from the coll47 probe that
    // parts 538-674 use bookIds roughly 4415-4800. We'll use AJAX to discover
    // which bookIds return audio for this partNum (website).
    // Use the subid's context to probe bookIds.
    // Since the audio PARTNUM in the audio URL might differ from the website partNum,
    // we look for bookIds whose audio URL contains ANY of the plausible audio PARTNUMs.

    // Strategy: probe the AJAX endpoint directly using bookIds from existing data
    // by looking at which audio PARTNUM matches.
    // The audio URL has format /fojing/1/X/AUDIO_PART/AUDIO_PART_LABEL.mp3
    // We need to find the AUDIO_PART that corresponds to website partNum.

    // Find it from existing data: look for audioPart where the subid matches
    // (subid = audioPart + 93)
    const expectedAudioPart = subid - 93;
    if (existingByAudioPart[expectedAudioPart]) {
      const existing = existingByAudioPart[expectedAudioPart];
      entries.push({
        part: partNum,
        title,
        subid,
        rawScrollCount: existing.rawScrollCount,
        scrollCount: existing.scrollCount,
        firstBookId: existing.firstBookId,
        collectionId: COLLECTION_ID,
        has0aPreface: existing.has0aPreface,
        mergeFileCount: existing.mergeFileCount,
        trailingMergeCount: existing.trailingMergeCount,
        bookIds: existing.bookIds,
        scrollLabels: existing.scrollLabels
      });
      console.log(`Part ${partNum}: "${title}" — matched audio part ${expectedAudioPart}, raw=${existing.rawScrollCount}, firstBookId=${existing.firstBookId}`);
    } else {
      console.log(`Part ${partNum}: "${title}" — WARNING: no audio data for expected audioPart ${expectedAudioPart} (subid=${subid})`);
    }

    await sleep(50);
  }

  // Save
  const outPath = path.join(__dirname, '..', 'parts_538_674_coll49_raw.json');
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`\nSaved ${entries.length} entries to ${outPath}`);

  console.log('\n=== CATALOG ENTRIES ===');
  for (const e of entries) {
    const flags = [];
    if (e.has0aPreface) flags.push(`has0aPreface: true`);
    if (e.mergeFileCount) flags.push(`mergeFileCount: ${e.mergeFileCount}`);
    if (e.trailingMergeCount > 1) flags.push(`trailingMergeCount: ${e.trailingMergeCount}`);
    const sc = e.trailingMergeCount > 1 ? e.rawScrollCount : e.scrollCount;
    const extra = flags.length ? ', ' + flags.join(', ') : '';
    console.log(`  { part: ${e.part}, title: '${e.title}', subid: ${e.subid}, scrollCount: ${sc}, firstBookId: ${e.firstBookId}, collectionId: ${COLLECTION_ID}${extra} },`);
  }

  console.log(`\nTotal entries: ${entries.length}`);
  const missing = PART_END - PART_START + 1 - entries.length;
  if (missing > 0) console.log(`WARNING: ${missing} parts are missing!`);
  console.log('Done.');
}

main().catch(console.error);
