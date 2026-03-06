// Improved script to fetch parts 372-537 with proper scroll detection and merging patterns
import fetch from 'node-fetch';
import iconv from 'iconv-lite';
import fs from 'fs';

// Disable SSL verification for expired certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const results = [];

async function fetchAudioUrl(bookId, menuid) {
  try {
    const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: `menuid=${menuid}&book=${bookId}&lang=zh`
    });
    const buffer = await response.arrayBuffer();
    const json = JSON.parse(iconv.decode(Buffer.from(buffer), 'gbk'));
    return json.links || json.audiolinks || '';
  } catch (error) {
    return null;
  }
}

async function detectScrollPattern(part, firstBookId, subid) {
  const menuid = `47|${subid}`;
  const audioUrls = [];

  // Check for 0a, 0b patterns
  const has0a = await fetchAudioUrl(firstBookId, menuid);
  if (has0a && has0a.includes('_0a.mp3')) {
    audioUrls.push('0a');
    const has0b = await fetchAudioUrl(firstBookId + 1, menuid);
    if (has0b && has0b.includes('_0b.mp3')) {
      audioUrls.push('0b');
    }
  }

  // Check regular scrolls
  let scrollNum = 1;
  let bookId = has0a && has0a.includes('_0a.mp3') ? firstBookId + audioUrls.length : firstBookId;

  while (scrollNum <= 20) { // Max 20 scrolls
    const audio = await fetchAudioUrl(bookId, menuid);
    if (!audio || !audio.includes(`/${part}/`)) break;

    // Check for a/b suffixes
    if (audio.includes(`_${scrollNum}a.mp3`)) {
      audioUrls.push(`${scrollNum}a`);
      const hasB = await fetchAudioUrl(bookId + 1, menuid);
      if (hasB && hasB.includes(`_${scrollNum}b.mp3`)) {
        audioUrls.push(`${scrollNum}b`);
        bookId += 2;
      } else {
        bookId += 1;
      }
    } else if (audio.includes(`_${scrollNum}.mp3`)) {
      audioUrls.push(`${scrollNum}`);
      bookId += 1;
    } else {
      break;
    }
    scrollNum++;
  }

  return audioUrls;
}

async function fetchPartInfo(part) {
  const subid = part + 93;

  // Estimate firstBookId (you'll need to adjust this based on actual data)
  // For now, use a linear approximation
  const estimatedFirstBookId = 4031 + (part - 372) * 2; // Rough estimate

  try {
    const scrollPattern = await detectScrollPattern(part, estimatedFirstBookId, subid);

    // Calculate actual scroll count
    const has0aPreface = scrollPattern[0] === '0a';
    const mergeFileCount = has0aPreface ? (scrollPattern[1] === '0b' ? 2 : 1) : 0;

    // Count unique scroll numbers
    const uniqueScrolls = new Set();
    scrollPattern.forEach(s => {
      const num = parseInt(s) || 0;
      if (num > 0) uniqueScrolls.add(num);
    });
    const scrollCount = has0aPreface ? uniqueScrolls.size + 1 : uniqueScrolls.size;

    console.log(`Part ${part}: ${scrollCount} scrolls, pattern: ${scrollPattern.join(', ')}`);

    return {
      part,
      subid,
      scrollCount,
      firstBookId: estimatedFirstBookId,
      collectionId: 47,
      has0aPreface,
      mergeFileCount: has0aPreface ? mergeFileCount : undefined,
      pattern: scrollPattern
    };
  } catch (error) {
    console.error(`Error fetching part ${part}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Detecting scroll patterns for parts 372-537...\n');

  // Sample first few parts to understand the pattern
  for (let part = 372; part <= 380; part++) {
    const info = await fetchPartInfo(part);
    if (info) {
      results.push(info);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  fs.writeFileSync(
    'parts_372_537_sample.json',
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ Sample complete! Saved ${results.length} parts`);
}

main();
