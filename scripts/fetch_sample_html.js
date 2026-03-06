// Fetch sample HTML to examine structure
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fetchPage(part) {
  const subid = part + 93;
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/48/subid/${subid}/`;

  console.log(`Fetching: ${url}\n`);

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const html = iconv.decode(Buffer.from(buffer), 'gbk');

  fs.writeFileSync(`sample_part_${part}.html`, html);
  console.log(`Saved to sample_part_${part}.html`);

  // Print first 2000 characters to see structure
  console.log('\nFirst 2000 characters:');
  console.log(html.substring(0, 2000));
}

// Fetch part 378 (should have 2 scrolls) and 395 (should have 3 scrolls)
Promise.all([
  fetchPage(378),
  fetchPage(395)
]).catch(console.error);
