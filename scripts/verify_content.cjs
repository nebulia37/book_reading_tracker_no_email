process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCatalog() {
  const dataPath = path.join(__dirname, '..', 'data.ts');
  const src = fs.readFileSync(dataPath, 'utf-8');
  const entries = [];
  // Use hex escape for single quote to avoid shell issues
  const lineRe = /part:\s*(\d+),\s*title:\s*\x27([^\x27]+)\x27,\s*subid:\s*(\d+),\s*scrollCount:\s*(\d+),\s*firstBookId:\s*(\d+),\s*collectionId:\s*(\d+)/g;
  let m;
  while ((m = lineRe.exec(src)) !== null) {
    entries.push({
      part: parseInt(m[1]),
      title: m[2],
      subid: parseInt(m[3]),
      scrollCount: parseInt(m[4]),
      firstBookId: parseInt(m[5]),
      collectionId: parseInt(m[6])
    });
  }
  return entries;
}

async function fetchWithRetry(url, options, retries) {
  retries = retries || 2;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp;
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1000);
    }
  }
}

async function fetchPageTitle(collectionId, subid) {
  const url = "https://w1.xianmijingzang.com/wap/tripitaka/id/" + collectionId + "/subid/" + subid + "/";
  const resp = await fetchWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(new Uint8Array(buf));
  const titleMatch = text.match(/<title>([^<]*)<\/title>/);
  if (!titleMatch) return null;
  const raw = titleMatch[1].trim();
  // Match: 第372部 十住斷結經
  const partMatch = raw.match(/\u7b2c\d+\u90e8\s+(.+)/);
  return partMatch ? partMatch[1].trim() : raw;
}

async function fetchContentTitle(collectionId, subid, bookId) {
  const resp = await fetchWithRetry("https://w1.xianmijingzang.com/wapajax/tripitaka/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: "menuid=" + collectionId + "|" + subid + "&book=" + bookId + "&lang=zh&only_content=1"
  });
  const buf = await resp.arrayBuffer();
  const html = iconv.decode(Buffer.from(buf), "gbk");
  const spans = [...html.matchAll(/<i><span>[^<]*<\/span><span>([^<]*)<\/span><\/i>/g)];
  const chars = spans.map(m => m[1]).join("").replace(/&nbsp;/g, " ").replace(/\s+/g, "").trim();
  return chars.substring(0, 60);
}

function normalizeForComparison(title) {
  if (!title) return "";
  return title
    .replace(/\u5377\u7b2c?[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\d]+/, "")
    .replace(/\u5377[\u4e0a\u4e2d\u4e0b]/, "")
    .replace(/\([^)]*\)/, "")
    .replace(/\uff08[^\uff09]*\uff09/, "")
    .trim();
}

function titlesMatch(catalogTitle, contentTitle) {
  if (!contentTitle) return false;
  const normContent = normalizeForComparison(contentTitle);
  const normCatalog = normalizeForComparison(catalogTitle);
  if (normContent.includes(normCatalog) || normCatalog.includes(normContent)) return true;
  if (normContent.length >= 2 && normCatalog.length >= 2) {
    const minLen = Math.min(normContent.length, normCatalog.length);
    const prefix = normContent.substring(0, minLen);
    if (normCatalog.startsWith(prefix) || prefix.startsWith(normCatalog)) return true;
  }
  return false;
}

async function main() {
  const catalog = parseCatalog();
  console.log("Parsed " + catalog.length + " catalog entries from data.ts");
  console.log("Parts range: " + catalog[0].part + " - " + catalog[catalog.length - 1].part + "\n");

  const mismatches = [];
  const errors = [];
  const matches = [];

  for (let idx = 0; idx < catalog.length; idx++) {
    const entry = catalog[idx];
    const { part, title, subid, firstBookId, collectionId } = entry;

    process.stdout.write("[" + (idx + 1) + "/" + catalog.length + "] Part " + part + " \"" + title + "\" (bookId=" + firstBookId + ", subid=" + subid + ") ... ");

    try {
      const pageTitle = await fetchPageTitle(collectionId, subid);
      await sleep(100);
      const contentChars = await fetchContentTitle(collectionId, subid, firstBookId);

      const pageMatch = !!(pageTitle && titlesMatch(title, pageTitle));
      const contentMatch = !!(contentChars && titlesMatch(title, contentChars));

      // Core title check
      const coreTitle = title.replace(/[\u4f5b\u8aaa]/g, "").substring(0, 4);
      const contentContainsCore = !!(contentChars && contentChars.includes(coreTitle));

      if (pageMatch && (contentMatch || contentContainsCore)) {
        console.log("OK");
        matches.push({ part, title, pageTitle, contentChars: contentChars.substring(0, 30) });
      } else {
        console.log("MISMATCH!");
        console.log("    Catalog title:  " + title);
        console.log("    Page title:     " + (pageTitle || "N/A"));
        console.log("    Content start:  " + (contentChars ? contentChars.substring(0, 40) : "N/A"));
        console.log("    Page match: " + pageMatch + ", Content match: " + contentMatch + ", Core match: " + contentContainsCore);
        mismatches.push({
          part, title, subid, firstBookId, collectionId,
          pageTitle,
          contentChars: contentChars ? contentChars.substring(0, 60) : null,
          pageMatch, contentMatch, contentContainsCore
        });
      }
    } catch (err) {
      console.log("ERROR: " + err.message);
      errors.push({ part, title, firstBookId, error: err.message });
    }

    await sleep(200);
  }

  console.log("\n" + "=".repeat(80));
  console.log("VERIFICATION SUMMARY");
  console.log("=".repeat(80));
  console.log("Total entries checked: " + catalog.length);
  console.log("Matches (OK):         " + matches.length);
  console.log("Mismatches:           " + mismatches.length);
  console.log("Errors:               " + errors.length);

  if (mismatches.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("MISMATCHES DETAIL:");
    console.log("-".repeat(80));
    for (const m of mismatches) {
      console.log("\nPart " + m.part + ":");
      console.log("  Catalog title:    " + m.title);
      console.log("  Page title:       " + (m.pageTitle || "N/A"));
      console.log("  Content (bookId " + m.firstBookId + "): " + (m.contentChars || "N/A"));
      console.log("  subid: " + m.subid + ", collectionId: " + m.collectionId);
      console.log("  Page match: " + m.pageMatch + ", Content match: " + m.contentMatch + ", Core match: " + m.contentContainsCore);
    }
  }

  if (errors.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("ERRORS:");
    console.log("-".repeat(80));
    for (const e of errors) {
      console.log("  Part " + e.part + " \"" + e.title + "\" (bookId=" + e.firstBookId + "): " + e.error);
    }
  }

  const resultsPath = path.join(__dirname, "..", "verify_results.json");
  fs.writeFileSync(resultsPath, JSON.stringify({ mismatches, errors, matchCount: matches.length }, null, 2));
  console.log("\nResults written to " + resultsPath);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
