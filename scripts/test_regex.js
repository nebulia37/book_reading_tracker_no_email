// Test regex pattern on sample HTML
import fs from 'fs';

const html = fs.readFileSync('sample_part_378.html', 'utf8');

console.log('Testing regex patterns...\n');

// Pattern 1: Original
const pattern1 = /<li\s+(?:class="[^"]*"\s+)?id="(\d+)"><b>(\d+)卷<\/b>/g;
const matches1 = [...html.matchAll(pattern1)];
console.log('Pattern 1 matches:', matches1.length);
matches1.forEach((m, i) => console.log(`  ${i + 1}. bookId: ${m[1]}, scroll: ${m[2]}`));

// Pattern 2: Simpler version
const pattern2 = /id="(\d+)"><b>(\d+)/g;
const matches2 = [...html.matchAll(pattern2)];
console.log('\nPattern 2 matches:', matches2.length);
matches2.forEach((m, i) => console.log(`  ${i + 1}. bookId: ${m[1]}, scroll: ${m[2]}`));

// Pattern 3: Look for the exact structure
const pattern3 = /<li[^>]+id="(\d+)"[^>]*><b>(\d+)/g;
const matches3 = [...html.matchAll(pattern3)];
console.log('\nPattern 3 matches:', matches3.length);
matches3.forEach((m, i) => console.log(`  ${i + 1}. bookId: ${m[1]}, scroll: ${m[2]}`));

console.log('\n---\n');
console.log('Sample HTML snippet:');
console.log(html.substring(html.indexOf('id="4050"') - 50, html.indexOf('id="4050"') + 100));
