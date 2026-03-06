// Script to fetch information for parts 372-537
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import fs from 'fs';

const results = [];

async function fetchPartInfo(part) {
  const subid = part + 93; // Formula: subid = part + 93
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/47/subid/${subid}/`;

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(buffer), 'gbk');

    // Extract title
    const titleMatch = html.match(/第\d+部\s+([^<]+)/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract scroll count (look for 卷1, 卷2, etc.)
    const scrollMatches = html.match(/(\d+)卷/g);
    const scrollCount = scrollMatches ? Math.max(...scrollMatches.map(m => parseInt(m))) : 1;

    console.log(`Part ${part}: ${title} (${scrollCount} scrolls)`);

    return {
      part,
      title,
      subid,
      scrollCount,
      collectionId: 47
    };
  } catch (error) {
    console.error(`Error fetching part ${part}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Fetching parts 372-537...\n');

  // Fetch in batches to avoid overwhelming the server
  for (let part = 372; part <= 537; part++) {
    const info = await fetchPartInfo(part);
    if (info) {
      results.push(info);
    }
    // Small delay to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Save to JSON file
  fs.writeFileSync(
    'parts_372_537.json',
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ Done! Saved ${results.length} parts to parts_372_537.json`);
}

main();
