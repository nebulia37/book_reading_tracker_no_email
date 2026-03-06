// Fetch actual titles for parts 372-537
import fetch from 'node-fetch';
import iconv from 'iconv-lite';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fetchTitle(part) {
  const subid = part + 93;
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/47/subid/${subid}/`;

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(buffer), 'gbk');

    // Extract title from pattern like: 第372部 十住斷結經
    const match = html.match(/第\d+部\s+([^<\n]+)/);
    const title = match ? match[1].trim() : '';

    return { part, title };
  } catch (error) {
    console.error(`Error fetching part ${part}:`, error.message);
    return { part, title: '' };
  }
}

async function main() {
  const results = [];

  console.log('Fetching titles for parts 372-537...\n');

  for (let part = 372; part <= 537; part++) {
    const { title } = await fetchTitle(part);
    console.log(`Part ${part}: ${title}`);
    results.push({ part, title });

    // Small delay to be nice to the server
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Output as JSON
  console.log('\n\n=== JSON OUTPUT ===\n');
  console.log(JSON.stringify(results, null, 2));
}

main();
