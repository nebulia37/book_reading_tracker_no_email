/**
 * Check audio availability for non-first scrolls of multi-scroll parts.
 * Focus on parts 675 (71 scrolls), 676 (60 scrolls), 710 (7 scrolls).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function checkAudio(part, bookId, menuid, label) {
  try {
    const resp = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: 'menuid=' + menuid + '&book=' + bookId + '&lang=zh'
    });
    const buffer = await resp.arrayBuffer();
    const text = iconv.decode(Buffer.from(buffer), 'gbk');
    const json = JSON.parse(text);
    const audioUrl = json.links || json.audiolinks || '';

    // Also check if the mp3 URL actually works
    if (audioUrl) {
      const fullUrl = audioUrl.startsWith('http') ? audioUrl : 'https://w1.xianmijingzang.com' + audioUrl;
      const headResp = await fetch(fullUrl, { method: 'HEAD' });
      const status = headResp.status;
      const contentType = headResp.headers.get('content-type') || '';
      console.log(label + ': audio=' + audioUrl.substring(0, 60) + ' | mp3 status=' + status + ' type=' + contentType);
      return { audioUrl, mp3Status: status, contentType };
    } else {
      console.log(label + ': NO AUDIO URL');
      return { audioUrl: '', mp3Status: 0 };
    }
  } catch(e) {
    console.log(label + ': ERROR ' + e.message);
    return { audioUrl: '', mp3Status: 0, error: e.message };
  }
}

async function main() {
  // Part 675: has0aPreface, scrollCount=71, firstBookId=4794, subid=648, collectionId=50
  // Scroll 1 -> bookId 4794 (0a), scroll 2 -> bookId 4796, scroll 3 -> bookId 4797...
  console.log('=== Part 675 (正法念處經, 71 scrolls, has0a) ===');
  const menuid675 = '50|648';
  // Check scroll 1 (0a), scroll 2, scroll 10, scroll 70
  for (const scroll of [1, 2, 3, 10, 35, 70]) {
    const bookId = scroll === 1 ? 4794 : 4794 + 2 + (scroll - 2);  // mergeCount=2
    await checkAudio(675, bookId, menuid675, 'Part 675 scroll ' + scroll + ' (bookId ' + bookId + ')');
    await sleep(200);
  }

  // Part 676: no has0a, scrollCount=60, firstBookId=4865, subid=782
  console.log('\n=== Part 676 (佛本行集經, 60 scrolls) ===');
  const menuid676 = '50|782';
  for (const scroll of [1, 2, 30, 59, 60]) {
    const bookId = 4865 + scroll - 1;
    await checkAudio(676, bookId, menuid676, 'Part 676 scroll ' + scroll + ' (bookId ' + bookId + ')');
    await sleep(200);
  }

  // Part 710: no has0a, scrollCount=7, firstBookId=4949, subid=816
  console.log('\n=== Part 710 (本事經, 7 scrolls) ===');
  const menuid710 = '50|816';
  for (const scroll of [1, 4, 7]) {
    const bookId = 4949 + scroll - 1;
    await checkAudio(710, bookId, menuid710, 'Part 710 scroll ' + scroll + ' (bookId ' + bookId + ')');
    await sleep(200);
  }
}

main().catch(console.error);
