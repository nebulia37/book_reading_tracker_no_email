/**
 * Check which parts have audio available upstream.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const parts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'parts_675_776_final.json'), 'utf-8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function checkAudio(partNum, bookId, menuid) {
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
    return audioUrl;
  } catch(e) {
    return 'ERROR: ' + e.message;
  }
}

async function main() {
  let noAudio = [];
  let hasAudio = [];

  for (const p of parts) {
    const menuid = p.collectionId + '|' + p.subid;
    const url = await checkAudio(p.partNum, p.firstBookId, menuid);
    if (!url) {
      console.log('Part ' + p.partNum + ' (' + p.title + '): NO AUDIO');
      noAudio.push(p.partNum);
    } else {
      console.log('Part ' + p.partNum + ' (' + p.title + '): ' + url.substring(0, 80));
      hasAudio.push(p.partNum);
    }
    await sleep(200);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Has audio: ' + hasAudio.length);
  console.log('No audio: ' + noAudio.length);
  if (noAudio.length > 0) {
    console.log('Parts without audio: ' + noAudio.join(', '));
  }
}

main().catch(console.error);
