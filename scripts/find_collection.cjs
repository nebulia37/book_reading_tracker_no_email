/**
 * Find which collectionId contains parts 675-776 on the upstream site.
 * Try multiple collection IDs and subids to locate Part 675.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPageTitle(collectionId, subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${collectionId}/subid/${subid}/`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const text = await resp.text();
    const titleMatch = text.match(/<title>([^<]*)<\/title>/);
    if (!titleMatch) return null;
    const raw = titleMatch[1].trim();
    const partMatch = raw.match(/第(\d+)部\s+(.+)/);
    if (partMatch) {
      return { partNum: parseInt(partMatch[1]), title: partMatch[2].trim(), collectionId, subid };
    }
    return { partNum: null, title: raw, collectionId, subid };
  } catch (err) {
    return { partNum: null, title: null, error: err.message, collectionId, subid };
  }
}

async function main() {
  // Try collection IDs from 45 to 55, checking subid 1 and a few others
  console.log('=== Scanning collections to find Part 675 ===\n');

  for (let cid = 43; cid <= 60; cid++) {
    // Try first few subids in each collection
    for (const subid of [1, 2, 3, 100, 200]) {
      const result = await fetchPageTitle(cid, subid);
      if (result && result.partNum) {
        console.log(`Collection ${cid}, subid ${subid}: Part ${result.partNum} - "${result.title}"`);
        if (result.partNum >= 600 && result.partNum <= 800) {
          console.log(`  *** POTENTIAL MATCH for parts 675-776! ***`);
        }
      }
      await sleep(150);
    }
  }

  // Also try higher collection IDs
  console.log('\n=== Trying higher collection IDs ===\n');
  for (let cid = 61; cid <= 80; cid++) {
    const result = await fetchPageTitle(cid, 1);
    if (result && result.partNum) {
      console.log(`Collection ${cid}, subid 1: Part ${result.partNum} - "${result.title}"`);
    }
    await sleep(150);
  }
}

main().catch(console.error);
