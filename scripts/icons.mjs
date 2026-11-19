// Ugradi odabrane Lucide ikone (lucide-static, ISC) u index.html između oznaka IKONE:START / IKONE:END.
// Pokretanje: npm run icons   (nakon dodavanja nove ikone u popis ispod)
import { readFileSync, writeFileSync } from 'node:fs';
const NAMES = ['house', 'folder', 'square-kanban', 'calendar-days', 'network', 'users', 'user-round', 'notebook-pen', 'chart-no-axes-column',
  'shield-user', 'menu', 'zap', 'mic', 'circle-user-round', 'paperclip', 'mail', 'link', 'pencil', 'x', 'trash-2', 'send',
  'triangle-alert', 'pin', 'star', 'inbox', 'bell', 'bell-off', 'book-open', 'circle-help', 'key-round', 'log-out', 'smartphone',
  'graduation-cap', 'sun', 'moon', 'sun-moon', 'copy', 'clipboard-list', 'repeat', 'message-square', 'list-checks', 'calendar'];
const icons = {};
for (const n of NAMES) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${n}.svg`, import.meta.url), 'utf8');
  icons[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').replace(/ \/>/g, '/>');
}
const file = new URL('../index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const block = `// IKONE:START — generira scripts/icons.mjs (Lucide, licenca ISC), ne uređivati ručno\nconst ICONS = ${JSON.stringify(icons)};\n// IKONE:END`;
const out = html.replace(/\/\/ IKONE:START[\s\S]*?\/\/ IKONE:END/, block);
if (out === html && !html.includes('// IKONE:START')) throw new Error('U index.html nema oznake // IKONE:START … // IKONE:END');
writeFileSync(file, out);
console.log('ikona:', NAMES.length, '·', Math.round(JSON.stringify(icons).length / 1024), 'kB');
