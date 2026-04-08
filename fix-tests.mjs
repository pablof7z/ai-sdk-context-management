const fs = require('fs');
const file = 'src/__tests__/scratchpad-strategy.test.ts';
let content = fs.readFileSync(file, 'utf-8');

const replacements = [
  [/userWithScratchpad\("4", "\(empty\)"\)/g, '"user:4"'],
  [/userWithScratchpad\("6", "\(empty\)"\)/g, '"user:6"'],
  [/userWithScratchpad\("3", "\(empty\)"\)/g, '"user:3"'],
];

let total = 0;
for (const [regex, replacement] of replacements) {
  const matches = content.match(regex);
  if (matches) {
    total += matches.length;
    content = content.replace(regex, replacement);
  }
}

fs.writeFileSync(file, content);
console.log(`Fixed ${total} occurrences`);