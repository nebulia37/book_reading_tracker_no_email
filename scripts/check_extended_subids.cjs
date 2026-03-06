/**
 * Check subids beyond 630 and around Part 467 to complete the mapping.
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
    if (!titleMatch) return { title: null, partNum: null };
    const raw = titleMatch[1].trim();
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
  console.log('=== Checking subids 631-640 (beyond current range) ===');
  for (let subid = 631; subid <= 640; subid++) {
    const result = await fetchPageTitle(48, subid);
    console.log(`subid ${subid}: Part ${result.partNum} - "${result.title}" ${result.error ? '(ERROR: ' + result.error + ')' : ''}`);
    await sleep(200);
  }

  console.log('\n=== Re-checking subids around Part 467 gap (559-565) ===');
  for (let subid = 559; subid <= 565; subid++) {
    const result = await fetchPageTitle(48, subid);
    console.log(`subid ${subid}: Part ${result.partNum} - "${result.title}"`);
    await sleep(200);
  }

  console.log('\n=== Checking the foreign subids 484 and 486 ===');
  for (const subid of [484, 486]) {
    const result = await fetchPageTitle(48, subid);
    console.log(`subid ${subid}: Part ${result.partNum} - "${result.title}"`);
    await sleep(200);
  }

  console.log('\n=== Checking duplicate area around subid 572-575 ===');
  for (let subid = 571; subid <= 576; subid++) {
    const result = await fetchPageTitle(48, subid);
    console.log(`subid ${subid}: Part ${result.partNum} - "${result.title}"`);
    await sleep(200);
  }
}

main().catch(console.error);
