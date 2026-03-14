/**
 * Fetch catalog data for parts 675-776 from upstream (collectionId 50).
 * Extracts title, subid, firstBookId, scrollCount, has0aPreface.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const COLLECTION_ID = 50;

async function fetchPageInfo(subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`;
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
  console.log(`Fetching parts 675-776 from collectionId ${COLLECTION_ID}...\n`);

  // Known subid mapping:
  // Part 675 = subid 648
  // Parts 676-776 = subids 782-883 (with subid 845 being a foreign entry)

  const subidsToCheck = [648]; // Part 675
  for (let s = 782; s <= 890; s++) {
    subidsToCheck.push(s);
  }

  const entries = [];
  const foreignEntries = [];

  for (const subid of subidsToCheck) {
    const info = await fetchPageInfo(subid);

    if (!info || !info.partNum) {
      if (info) {
        console.log(`subid ${subid}: "${info.title}" (FOREIGN/NO PART NUM - SKIP)`);
        foreignEntries.push({ subid, title: info.title });
      }
      await sleep(150);
      continue;
    }

    if (info.partNum >= 675 && info.partNum <= 776) {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (${info.scrollCount} scrolls, firstBookId=${info.firstBookId}${info.has0a ? ', has0a' : ''})`);
      entries.push(info);
    } else if (info.partNum > 776) {
      console.log(`subid ${subid}: Part ${info.partNum} - past range, stopping`);
      break;
    } else {
      console.log(`subid ${subid}: Part ${info.partNum} - "${info.title}" (OUT OF RANGE)`);
    }

    await sleep(150);
  }

  console.log(`\n=== Found ${entries.length} parts ===`);
  console.log(`Foreign/skipped entries: ${foreignEntries.length}`);
  if (foreignEntries.length > 0) {
    console.log('Foreign entries:');
    foreignEntries.forEach(e => console.log(`  subid ${e.subid}: "${e.title}"`));
  }

  // Sort by part number
  entries.sort((a, b) => a.partNum - b.partNum);

  // Output catalog entries
  console.log('\nCATALOG ENTRIES:');
  for (const p of entries) {
    const extra = p.has0a ? `, has0aPreface: true` : '';
    console.log(`  { part: ${p.partNum}, title: '${p.title}', subid: ${p.subid}, scrollCount: ${p.scrollCount}, firstBookId: ${p.firstBookId}, collectionId: ${COLLECTION_ID}${extra} },`);
  }

  // Save to JSON
  const outPath = path.join(__dirname, '..', 'parts_675_776_final.json');
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
  console.log(`\nFull data saved to ${outPath}`);
}

main().catch(console.error);
