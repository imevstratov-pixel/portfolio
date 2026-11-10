// The new guide is an authored overlay on the external site-content export.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const common = read('content-source/frameworks/guide.json');
const editorial = read('content-source/frameworks/editorial.json');
const research = read('content-source/frameworks/sources.json');
const guide = { ...common, ...editorial, sources: research.sources };
guide.frameworks = guide.frameworks.map((framework) => ({ ...framework, sourceIds: framework.sourceIds ?? [] }));
const ids = new Set();
for (const framework of guide.frameworks) {
  if (!/^[a-z0-9-]+$/.test(framework.id) || ids.has(framework.id)) throw new Error(`Invalid/duplicate framework: ${framework.id}`);
  ids.add(framework.id);
  if (!guide.tiers.some((t) => t.id === framework.tier)) throw new Error(`Unknown tier: ${framework.tier}`);
  for (const key of ['name', 'alias', 'definition', 'example', 'strength', 'limit', 'artifact']) {
    if (!framework[key]?.trim()) throw new Error(`${framework.id}: missing ${key}`);
  }
  if (!framework.steps?.length) throw new Error(`${framework.id}: no application steps`);
  for (const id of framework.sourceIds) if (!guide.sources.some((s) => s.id === id)) throw new Error(`${framework.id}: unknown source ${id}`);
}
const stackIds = new Set();
for (const stack of guide.stacks) {
  if (!/^[a-z0-9-]+$/.test(stack.id) || stackIds.has(stack.id)) throw new Error(`Invalid/duplicate stack: ${stack.id}`);
  stackIds.add(stack.id);
  for (const id of stack.frameworks) if (!ids.has(id)) throw new Error(`${stack.id}: unknown framework ${id}`);
  const recommendations = [...stack.recommendation.core, ...stack.recommendation.optional];
  const recommendedIds = new Set(recommendations.map((item) => item.framework));
  if (!stack.recommendation.core.length || recommendedIds.size !== recommendations.length ||
      recommendedIds.size !== stack.frameworks.length || stack.frameworks.some((id) => !recommendedIds.has(id))) {
    throw new Error(`${stack.id}: recommendations must cover each framework exactly once`);
  }
  for (const item of recommendations) if (!item.role?.trim()) throw new Error(`${stack.id}: missing role for ${item.framework}`);
  for (const step of stack.steps) if (step.framework && !ids.has(step.framework)) throw new Error(`${stack.id}: unknown step framework ${step.framework}`);
}
if (guide.stacks.length !== 7) throw new Error('The guide promises seven product stacks');
const publicText = JSON.stringify(guide);
if (/_note|_todo|_draft|hidden|МЕСТО ДЛЯ/.test(publicText)) throw new Error('Internal marker in guide');
mkdirSync(resolve(root, 'src/content/frameworks'), { recursive: true });
writeFileSync(resolve(root, 'src/content/frameworks/guide.json'), JSON.stringify(guide, null, 2) + '\n');

const cataloguePath = resolve(root, 'src/content/pages/free.md');
let catalogue = readFileSync(cataloguePath, 'utf8');
// Remove only this overlay's previous item. Preserve every existing byte of
// the other authored materials and their frontmatter.
const start = catalogue.indexOf(`  - id: ${common.slug}\n`);
if (start !== -1) {
  const rest = catalogue.slice(start + 1);
  const next = rest.search(/\n(?:  - id:|- id:)/);
  if (next === -1) throw new Error('Cannot locate catalogue boundary');
  catalogue = catalogue.slice(0, start) + rest.slice(next + 1);
}
const item = YAML.stringify([guide.catalogue], { lineWidth: 0 }).trimEnd().split('\n').map((line) => `  ${line}`).join('\n');
const marker = '  type: free-items\n  items:\n';
if (!catalogue.includes(marker)) throw new Error('Free catalogue structure changed');
catalogue = catalogue.replace(marker, `${marker}${item}\n`);
writeFileSync(cataloguePath, catalogue);
console.log(`Exported ${guide.frameworks.length} approaches, ${guide.stacks.length} stacks and one catalogue item`);
