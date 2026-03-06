// Generate final catalog from detected scroll counts
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scroll_counts_correct_372_537.json', 'utf8'));

console.log('// Scripture Catalog - Parts 372-537');
console.log('// Auto-generated from scroll count detection\n');

const entries = data.map(item => {
  const { part, title, subid, scrollCount, firstBookId, collectionId } = item;
  return `  { part: ${part}, title: '${title.replace(/'/g, "\\'")}', subid: ${subid}, scrollCount: ${scrollCount}, firstBookId: ${firstBookId}, collectionId: ${collectionId} }`;
});

console.log(entries.join(',\n'));

// Save to file
fs.writeFileSync('catalog_372_537_final.txt', entries.join(',\n'));
console.log('\n\n✅ Catalog saved to catalog_372_537_final.txt');

// Print statistics
const totalScrolls = data.reduce((sum, item) => sum + item.scrollCount, 0);
const multiScrollParts = data.filter(item => item.scrollCount > 1);

console.log(`\nStatistics:`);
console.log(`  Total parts: ${data.length}`);
console.log(`  Total scrolls: ${totalScrolls}`);
console.log(`  Parts with multiple scrolls: ${multiScrollParts.length}`);
console.log(`  First bookId: ${data[0].firstBookId}`);
console.log(`  Last bookId: ${data[data.length - 1].firstBookId + data[data.length - 1].scrollCount - 1}`);
