// Generate catalog entries for parts 372-537
const entries = [];

// Part 372 has 14 scrolls (confirmed by user)
entries.push(`  { part: 372, title: 'Part 372', subid: 465, scrollCount: 14, firstBookId: 4031, collectionId: 47 }`);

// Generate remaining parts (373-537) with default 1 scroll each
for (let part = 373; part <= 537; part++) {
  const subid = part + 93;
  const firstBookId = 4045 + (part - 373);
  entries.push(`  { part: ${part}, title: 'Part ${part}', subid: ${subid}, scrollCount: 1, firstBookId: ${firstBookId}, collectionId: 47 }`);
}

console.log(entries.join(',\n'));
