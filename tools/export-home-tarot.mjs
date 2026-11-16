import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(resolve(root, 'content-source/home/tarot.json'), 'utf8'));
const ids = ['magician', 'emperor', 'sun'];
if (source.cards?.length !== 3 || source.hints?.length !== 3 || source.cards.some((card, i) => card.id !== ids[i])) {
  throw new Error('The home spread must contain the three fixed cards and three progress hints');
}
for (const key of ['label', 'idleHint', 'completeHint', 'message', 'fallback', 'backImage']) {
  if (!source[key]?.trim()) throw new Error(`Tarot copy: missing ${key}`);
}
for (const card of source.cards) for (const key of ['name', 'image', 'openLabel', 'openedLabel']) {
  if (!card[key]?.trim()) throw new Error(`Tarot ${card.id}: missing ${key}`);
}
for (const path of [source.backImage, ...source.cards.map((card) => card.image)]) {
  if (!/^\/assets\/tarot\/[a-z-]+\.webp$/.test(path)) throw new Error(`Invalid tarot image path: ${path}`);
}
if (/_note|_todo|_draft|hidden|МЕСТО ДЛЯ/.test(JSON.stringify(source))) throw new Error('Internal marker in tarot copy');
mkdirSync(resolve(root, 'src/content/home'), { recursive: true });
writeFileSync(resolve(root, 'src/content/home/tarot.json'), JSON.stringify(source, null, 2) + '\n');
console.log('Exported the home tarot spread');
