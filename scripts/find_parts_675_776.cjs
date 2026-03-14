/**
 * Scan subids to find parts 675-776.
 * Part 537 was at subid 632, so parts 675+ should be at higher subids.
 * Need to account for foreign/duplicate entries in between.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPageInfo(collectionId, subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${collectionId}/subid/${subid}/`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
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
        has0a: scrollLabels.length > 0 && scrollLabels[0].includes('0a')
      };
    }
    return { partNum: null, title: raw, subid, bookIds, scrollLabels, firstBookId: null, scrollCount: 0, has0a: false };
  } catch (err) {
    return null;
  }
}

async function main() {
  const collectionId = 48; // Use same collection as before

  // First, find Part 675 by scanning subids
  // Part 537 = subid 632. We need to scan upward to find Part 675.
  // There could be ~140 parts between 537 and 675, plus foreign entries.
  // Start scanning from subid 634 (after Part 467 at 633)

  console.log('=== Scanning subids 634-1000 to find parts 538-776 ===\n');

  const allParts = [];
  let foundFirst675 = false;

  for (let subid = 634; subid <= 1200; subid++) {
    const info = await fetchPageInfo(collectionId, subid);

    if (!info || !info.partNum) {
      // Check if we've gone past the end
      if (subid > 900 && allParts.length > 0 && allParts[allParts.length - 1].partNum >= 776) {
        console.log(`Reached end at subid ${subid}`);
        break;
      }
      if (info) {
        console.log(`subid ${subid}: "${info.title}" (no part number - possible foreign entry)`);
      }
      await sleep(150);
      continue;
    }

    if (info.partNum >= 675 && !foundFirst675) {
      console.log(`\n*** Found Part 675 region! ***\n`);
      foundFirst675 = true;
    }

    if (info.partNum >= 675 && info.partNum <= 776) {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (${info.scrollCount} scrolls, firstBookId=${info.firstBookId}${info.has0a ? ', has0a' : ''})`);
      allParts.push(info);
    } else if (info.partNum >= 538 && info.partNum < 675) {
      // Between our old range and new range - just log briefly
      if (info.partNum % 20 === 0 || info.partNum === 538) {
        console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (skipping, not in 675-776 range)`);
      }
    } else if (info.partNum > 776) {
      console.log(`subid ${subid}: Part ${info.partNum} - past target range, stopping`);
      break;
    } else {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (FOREIGN/OUT-OF-RANGE)`);
    }

    await sleep(150);
  }

  console.log(`\n=== Found ${allParts.length} parts in range 675-776 ===\n`);

  // Output catalog entries
  if (allParts.length > 0) {
    console.log('CATALOG ENTRIES:');
    for (const p of allParts) {
      const extra = p.has0a ? ', has0aPreface: true' : '';
      console.log(`  { part: ${p.partNum}, title: '${p.title}', subid: ${p.subid}, scrollCount: ${p.scrollCount}, firstBookId: ${p.firstBookId}, collectionId: ${collectionId}${extra} },`);
    }
  }

  // Save to JSON
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', 'parts_675_776.json');
  fs.writeFileSync(outPath, JSON.stringify(allParts, null, 2));
  console.log(`\nFull data saved to ${outPath}`);
}

main().catch(console.error);
