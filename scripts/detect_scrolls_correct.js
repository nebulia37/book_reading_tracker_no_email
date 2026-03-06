// Correctly detect scroll counts by parsing <li> elements with scroll indicators
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

    // Look for pattern: <li id="XXXX"><b>N
    // This indicates scroll N with bookId XXXX
    const scrollPattern = /<li[^>]+id="(\d+)"[^>]*><b>(\d+)/g;
    const matches = [...html.matchAll(scrollPattern)];

    if (matches.length > 0) {
      // Found scroll indicators
      const scrollCount = matches.length;
      const firstBookId = parseInt(matches[0][1]);
      return { scrollCount, firstBookId };
    }

    // No scroll indicators found - might be a single scroll text
    // Look for alternative pattern or default to 1
    return { scrollCount: 1, firstBookId: null };
  } catch (error) {
    console.error(`Error fetching part ${part}:`, error.message);
    return { scrollCount: 1, firstBookId: null };
  }
}

async function main() {
  // Load titles
  const titles = JSON.parse(fs.readFileSync('titles_372_537.json', 'utf8'));
  const results = [];

  console.log('Correctly detecting scroll counts for parts 372-537...\n');

  let estimatedBookId = 4031; // Starting bookId for part 372

  for (let i = 0; i < titles.length; i++) {
    const { part, title } = titles[i];
    const subid = part + 93;

    // Get scroll count and firstBookId from HTML
    const { scrollCount, firstBookId } = await fetchScrollCountFromHTML(part);

    // Use detected firstBookId if available, otherwise use estimated
    const actualFirstBookId = firstBookId || estimatedBookId;

    console.log(`Part ${part}: ${title} - ${scrollCount} scroll(s), firstBookId: ${actualFirstBookId}`);

    results.push({
      part,
      title,
      subid,
      scrollCount,
      firstBookId: actualFirstBookId,
      collectionId: 48
    });

    // Update estimated bookId for next part
    estimatedBookId = actualFirstBookId + scrollCount;

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Save results
  fs.writeFileSync('scroll_counts_correct_372_537.json', JSON.stringify(results, null, 2));
  console.log(`\n✅ Done! Saved to scroll_counts_correct_372_537.json`);

  // Print summary
  const multiScrollParts = results.filter(r => r.scrollCount > 1);
  console.log(`\nParts with multiple scrolls (${multiScrollParts.length}):`);
  multiScrollParts.forEach(p => {
    console.log(`  Part ${p.part}: ${p.title} (${p.scrollCount} scrolls, bookId: ${p.firstBookId})`);
  });
}

main();
