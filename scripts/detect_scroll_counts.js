// Detect scroll counts for parts 372-537
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function detectScrollCount(part, subid, estimatedFirstBookId) {
  const collectionId = 48;
  const menuid = `${collectionId}|${subid}`;

  let scrollCount = 0;
  let currentBookId = estimatedFirstBookId;

  // Check up to 20 scrolls max
  for (let scroll = 1; scroll <= 20; scroll++) {
    try {
      const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: `menuid=${menuid}&book=${currentBookId}&lang=zh`
      });

      const buffer = await response.arrayBuffer();
      const json = JSON.parse(iconv.decode(Buffer.from(buffer), 'gbk'));
      const audioUrl = json.links || json.audiolinks || '';

      // Check if this bookId belongs to this part
      if (audioUrl && audioUrl.includes(`/${part}/`)) {
        scrollCount = scroll;
        currentBookId++;
      } else {
        break;
      }
    } catch (error) {
      break;
    }
  }

  return scrollCount;
}

async function main() {
  const titles = JSON.parse(fs.readFileSync('titles_372_537.json', 'utf8'));
  const results = [];

  console.log('Detecting scroll counts for parts 372-537...\n');

  for (let i = 0; i < titles.length; i++) {
    const { part, title } = titles[i];
    const subid = part + 93;
    const estimatedFirstBookId = part === 372 ? 4031 : 4045 + (part - 373);

    const scrollCount = await detectScrollCount(part, subid, estimatedFirstBookId);

    console.log(`Part ${part}: ${title} - ${scrollCount} scrolls`);

    results.push({
      part,
      title,
      subid,
      scrollCount,
      firstBookId: estimatedFirstBookId,
      collectionId: 48
    });

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Save results
  fs.writeFileSync('scroll_counts_372_537.json', JSON.stringify(results, null, 2));
  console.log(`\n✅ Done! Saved to scroll_counts_372_537.json`);
}

main();
