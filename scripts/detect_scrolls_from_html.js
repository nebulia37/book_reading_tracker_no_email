// Detect actual scroll counts by scraping HTML pages
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fetchScrollCountFromHTML(part) {
  const subid = part + 93;
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/48/subid/${subid}/`;

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(buffer), 'gbk');

    // Look for scroll indicators in the HTML
    // Common patterns: "卷第一", "卷第二", "第1卷", "第2卷", "卷1", "卷2", etc.
    const patterns = [
      /卷第[一二三四五六七八九十百]+/g,
      /第[0-9]+卷/g,
      /卷[0-9]+/g,
      /\d+卷/g
    ];

    let maxScroll = 0;

    for (const pattern of patterns) {
      const matches = html.match(pattern);
      if (matches && matches.length > 0) {
        // Convert Chinese numerals to numbers if needed
        const chineseNums = {
          '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
          '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
          '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
          '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20
        };

        matches.forEach(match => {
          // Extract number from match
          let num = 0;
          const arabicMatch = match.match(/\d+/);
          if (arabicMatch) {
            num = parseInt(arabicMatch[0]);
          } else {
            const chineseMatch = match.match(/[一二三四五六七八九十百]+/);
            if (chineseMatch && chineseNums[chineseMatch[0]]) {
              num = chineseNums[chineseMatch[0]];
            }
          }
          if (num > maxScroll) maxScroll = num;
        });
      }
    }

    // Default to 1 if no scrolls found
    return maxScroll || 1;
  } catch (error) {
    console.error(`Error fetching part ${part}:`, error.message);
    return 1;
  }
}

async function main() {
  // Load titles
  const titles = JSON.parse(fs.readFileSync('titles_372_537.json', 'utf8'));
  const results = [];

  console.log('Detecting scroll counts from HTML for parts 372-537...\n');

  let currentBookId = 4031; // Starting bookId for part 372

  for (let i = 0; i < titles.length; i++) {
    const { part, title } = titles[i];
    const subid = part + 93;

    // Get scroll count from HTML
    const scrollCount = await fetchScrollCountFromHTML(part);

    console.log(`Part ${part}: ${title} - ${scrollCount} scroll(s)`);

    results.push({
      part,
      title,
      subid,
      scrollCount,
      firstBookId: currentBookId,
      collectionId: 48
    });

    // Update bookId for next part
    currentBookId += scrollCount;

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Save results
  fs.writeFileSync('scroll_counts_final_372_537.json', JSON.stringify(results, null, 2));
  console.log(`\n✅ Done! Saved to scroll_counts_final_372_537.json`);

  // Print summary
  const multiScrollParts = results.filter(r => r.scrollCount > 1);
  console.log(`\nParts with multiple scrolls (${multiScrollParts.length}):`);
  multiScrollParts.forEach(p => {
    console.log(`  Part ${p.part}: ${p.title} (${p.scrollCount} scrolls)`);
  });
}

main();
