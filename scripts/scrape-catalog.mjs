/**
 * One-time script to scrape scripture catalog from xianmijingzang.com
 * Fetches titles, scroll counts, and book IDs for parts 122-371 (collection 47)
 *
 * Usage: node scripts/scrape-catalog.mjs > scripts/catalog-output.ts
 */

const COLLECTION_ID = 47;
const DELAY_MS = 200;

async function fetchScripturePage(subid) {
  const url = `https://w1.xianmijingzang.com/wap/tripitaka/id/${COLLECTION_ID}/subid/${subid}/`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return await response.text(); // page is UTF-8
}

function extractInfo(html, subid) {
  // Extract title from <title> tag: "第122部 金光明最勝王經"
  const titleMatch = html.match(/<title>第(\d+)部\s+(.+?)<\/title>/);
  if (!titleMatch) return null;
  const part = parseInt(titleMatch[1]);
  if (part < 122 || part > 371) return null;
  const title = titleMatch[2].trim();

  // Extract book IDs from <li id="XXXX"> elements
  const bookIds = [...html.matchAll(/<li[^>]*\bid="(\d+)"/g)]
    .map(m => parseInt(m[1]))
    .filter(id => id > 1000) // filter out non-bookId ids
    .sort((a, b) => a - b);

  const scrollCount = bookIds.length || 1;
  const firstBookId = bookIds.length > 0 ? bookIds[0] : 0;

  return { part, title, subid, scrollCount, firstBookId };
}

async function main() {
  console.error('Scraping catalog for parts 122-371 (collection 47)...');
  const catalog = [];
  const seenParts = new Set();

  for (let subid = 191; subid <= 470; subid++) {
    const html = await fetchScripturePage(subid);
    if (!html) {
      console.error(`  subid ${subid}: no response`);
      continue;
    }

    const info = extractInfo(html, subid);
    if (info && !seenParts.has(info.part)) {
      seenParts.add(info.part);
      catalog.push(info);
      console.error(`  Part ${info.part} (subid ${subid}): "${info.title}" - ${info.scrollCount} scrolls, firstBookId ${info.firstBookId}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Sort by part number
  catalog.sort((a, b) => a.part - b.part);

  console.error(`\nFound ${catalog.length} scriptures, total scrolls: ${catalog.reduce((s, e) => s + e.scrollCount, 0)}\n`);

  // Output TypeScript array
  console.log('export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [');
  for (const entry of catalog) {
    const escapedTitle = entry.title.replace(/'/g, "\\'");
    console.log(`  { part: ${entry.part}, title: '${escapedTitle}', subid: ${entry.subid}, scrollCount: ${entry.scrollCount}, firstBookId: ${entry.firstBookId}, collectionId: ${COLLECTION_ID} },`);
  }
  console.log('];');
}

main().catch(console.error);
