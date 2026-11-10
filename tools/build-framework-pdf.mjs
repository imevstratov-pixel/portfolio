#!/usr/bin/env node
// Print the same authored data that powers the interactive methodology guide.
// Chromium only renders this local, generated document to PDF.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { frameworkConfig } from './guide-pdf/frameworks.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, process.argv[2] ?? 'src/content/frameworks/guide.json');
const guide = JSON.parse(readFileSync(source, 'utf8'));
if (!Array.isArray(guide.frameworks) || !Array.isArray(guide.stacks) || !Array.isArray(guide.sources)) {
  throw new Error('Export the shared guide first: node tools/export-framework-guide.mjs');
}
const sources = new Map(guide.sources.map((s) => [s.id, s]));
const frameworks = new Map(guide.frameworks.map((f) => [f.id, f]));
const text = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const cell = (value) => text(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const modelName = (framework) => framework.alias.split(' / ')[0];
const sourceLink = (id) => {
  const source = sources.get(id);
  if (!source) throw new Error(`Unknown source ${id}`);
  return `[${source.title}](${source.url})`;
};
const recommendationItem = ({ framework: id, role }) => {
  const framework = frameworks.get(id);
  if (!framework) throw new Error(`Unknown framework ${id}`);
  return `- **${modelName(framework)}.** ${role}`;
};

function markdown() {
  const out = [];
  const p = (s = '') => out.push(text(s), '');
  const serviceOffer = (id) => {
    const offer = guide.serviceOffers?.[id];
    if (!offer?.title || !offer.text || !offer.links?.length) throw new Error(`Missing service offer ${id}`);
    p(`SERVICE_OFFER_START_${id}`);
    p(`### ${offer.title}`);
    p(offer.text);
    p(offer.links.map(({ label, href }) => `[${label}](${new URL(href, 'https://danilevstratov.ru').href})`).join('; '));
    p('SERVICE_OFFER_END');
  };
  p(`# ${guide.title}`);
  p(guide.lead);
  p(guide.audience);
  p(guide.subtitle);
  p('Другие материалы автора: [danilevstratov.ru](https://danilevstratov.ru/).');
  p(`## ${guide.intro.title}`);
  guide.intro.paragraphs.forEach(p);
  p('```text\nРЕЗУЛЬТАТ  ->  ПРОВЕРКА  ->  ПРАКТИКА  ->  ПОДДЕРЖКА\n```');
  guide.intro.steps.forEach((step) => p(`**${step.title}.** ${step.text}`));
  p(guide.intro.exampleDisclaimer);

  p(`## ${guide.tierTitle}`);
  p(guide.tierLead);
  p(guide.tierCaveat);
  p('| Тир | Приоритет | Подходы |\n| --- | --- | --- |\n' + guide.tiers.map((tier) =>
    `| ${tier.id} | ${cell(tier.name)} | ${guide.frameworks.filter((f) => f.tier === tier.id).map((f) => cell(modelName(f))).join('; ')} |`).join('\n'));
  p(guide.tierContext);

  p(`## ${guide.stacksTitle}`);
  p(guide.stacksLead);
  guide.stacks.forEach((stack, index) => {
    p(`### ${index + 1}. ${stack.name}`);
    p(stack.scenario);
    p(`**${guide.stackLabels.goal}.** ${stack.goal}`);
    if (!stack.recommendation?.core?.length) throw new Error(`Missing recommended stack for ${stack.id}`);
    p('STACK_RECOMMENDATION_START');
    p(`#### ${guide.stackLabels.frameworks}`);
    p(guide.stackLabels.recommendation);
    p(stack.recommendation.core.map(recommendationItem).join('\n'));
    if (stack.recommendation.optional?.length) {
      p(`#### ${guide.stackLabels.optional}`);
      p(stack.recommendation.optional.map(recommendationItem).join('\n'));
    }
    p('STACK_RECOMMENDATION_END');
    for (const [i, step] of stack.steps.entries()) {
      p(`**${i + 1}. ${step.title}.** ${step.text}${step.artifact ? ` **Что подготовить:** ${step.artifact}` : ''}`);
    }
    p(`**${guide.stackLabels.check}.** ${stack.check}`);
    p(`**${guide.stackLabels.limit}.** ${stack.limit}`);
  });
  serviceOffer('consulting');

  p(`## ${guide.frameworksTitle}`);
  p(guide.frameworksLead);
  for (const framework of guide.frameworks) {
    p(`### ${framework.tier} · ${framework.name}`);
    p([framework.group, framework.alias].filter(Boolean).join(' / '));
    p(`**${framework.question}**`);
    p(framework.definition);
    p(framework.example);
    p(`**${guide.frameworkLabels.apply}.** ${framework.steps.map((step, index) => `${index + 1}) ${step}`).join(' ')}`);
    p(`**${guide.frameworkLabels.strength}.** ${framework.strength}`);
    p(`**${guide.frameworkLabels.limit}.** ${framework.limit}`);
    p(`**${guide.frameworkLabels.artifact}.** ${framework.artifact}`);
    if (framework.sourceIds?.length) p(`**${guide.frameworkLabels.source}.** ${framework.sourceIds.map(sourceLink).join('; ')}`);
  }

  p(`## ${guide.sequence.title}`);
  p(guide.sequence.lead);
  for (const item of guide.sequence.items) { p(`### ${item.name}`); p(item.text); }
  p(guide.sequence.after);
  p('ILLUSTRATION_PRACTICE');
  serviceOffer('audit');

  p(`## ${guide.worksheet.title}`);
  p(guide.worksheet.lead);
  for (const [i, field] of guide.worksheet.fields.entries()) {
    p(`### ${i + 1}. ${field.label}`);
    p(`Например: ${field.placeholder}`);
    p('WORKSHEET_LINE');
  }
  p(guide.worksheet.closing);
  serviceOffer('build');

  p(`## ${guide.sourcesTitle}`);
  p(guide.sourcesLead);
  p(guide.updated);
  // Keep the beginner's reading list compact. Every model still links to its
  // own source in the corresponding card, including the specialist B/C tiers.
  const readingList = new Set(guide.frameworks.filter((framework) => ['S', 'A', 'D'].includes(framework.tier)).flatMap((framework) => framework.sourceIds ?? []));
  readingList.add('spiral');
  p('Здесь — источники основы гайда. Ссылки на специальные модели также есть в соответствующих карточках.');
  for (const source of guide.sources.filter((source) => readingList.has(source.id))) {
    p(`**[${source.title}](${source.url})** — ${source.type}. ${source.supports}`);
  }
  return out.join('\n');
}

// Match the deterministic Bayer presentation used by DitherPortrait. This
// freezes the site's rendering for print; the original generated JPGs stay
// unchanged. Tone mapping and the Bayer matrix mirror glyphs/core.ts and
// glyphs/dither-portrait.ts.
function bayer(n) {
  if (n === 1) return [0];
  const h = n / 2, m = bayer(h), q = [0, 2, 3, 1], out = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push(4 * m[(y % h) * h + x % h] + q[Math.floor(y / h) * 2 + Math.floor(x / h)]);
  return out;
}
function blur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  function pass(a, b, horiz) {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let k = 0; k < m; k++) {
      const at = (i) => a[horiz ? k * w + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * w + k];
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < n; i++) { b[horiz ? k * w + i : i * w + k] = acc / (2 * r + 1); acc += at(i + r + 1) - at(i - r); }
    }
  }
  pass(src, tmp, true); pass(tmp, out, false); pass(out, tmp, true); pass(tmp, out, false);
  return out;
}
async function printImage(path) {
  const w = 640;
  const { data, info } = await sharp(join(root, 'public', path)).resize({ width: w }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const h = info.height, L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < L.length; i++, j += info.channels) L[i] = (data[j] * .2126 + data[j + 1] * .7152 + data[j + 2] * .0722) / 255;
  const sorted = Float32Array.from(L).sort(), lo = sorted[Math.floor(L.length * .02)], hi = sorted[Math.floor(L.length * .98)], span = Math.max(.001, hi - lo);
  for (let i = 0; i < L.length; i++) L[i] = Math.min(1, Math.max(0, (L[i] - lo) / span));
  const soft = blur(L, w, h, Math.max(2, Math.round(w / 24))), B = bayer(8).map((v) => (v + .5) / 64), pixels = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, tone = Math.pow(Math.min(1, Math.max(0, L[i] + .7 * (L[i] - soft[i]))), 1.15);
    pixels[i] = tone > B[(y & 7) * 8 + (x & 7)] ? 255 : 0;
  }
  const png = await sharp(pixels, { raw: { width: w, height: h, channels: 1 } }).resize(w * 2, h * 2, { kernel: 'nearest' }).png({ palette: true, colours: 2 }).toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const tmp = join(root, 'tmp', 'pdfs');
mkdirSync(tmp, { recursive: true });
const mdPath = join(tmp, `${guide.slug}.md`);
writeFileSync(mdPath, markdown());
const images = { hero: await printImage(guide.heroImage.src), practice: await printImage(guide.practiceImage.src) };
if (!process.env.CHROMIUM_PATH) {
  const { chromium } = await import('playwright');
  const candidates = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const available = candidates.find(existsSync);
  if (available) process.env.CHROMIUM_PATH = available;
}
const { buildGuide } = await import('./guide-pdf/engine.mjs');
await buildGuide(frameworkConfig(guide, images), mdPath);
