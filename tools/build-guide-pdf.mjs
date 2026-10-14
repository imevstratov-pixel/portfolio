#!/usr/bin/env node
// The free guide «Как разработать онлайн-курс» as a PDF for /free/, plus its
// cover image. Run by hand when the guide text changes; it is not part of the
// site build. Commit both outputs.
//
//   node tools/build-guide-pdf.mjs <guide draft .md>
//   GUIDE_SRC=<guide draft .md> node tools/build-guide-pdf.mjs
//
// Input: the guide draft. It lives outside this repository, like the annotated
// content, because its end holds notes for Daniil: only the text before the
// heading «# Для Даниила» is used, and the build fails if anything internal is
// left. «[адрес сайта]» becomes the live site address. Every link must be a
// full URL (https:, mailto:); links to the site get UTM tags, so Metrika shows
// visits from the PDF; the printed text shows the address without them.
//
// Output (public/free/):
// - kak-razrabotat-onlajn-kurs.pdf: A4, black and white, the site's type
//   system (Inter Tight and IBM Plex Mono from @fontsource, embedded; colours
//   and font stacks from src/styles/tokens.css): a cover (title, who it is
//   for, the three stages, Daniil's name, the site address), the intro with
//   the contents and page numbers, then the guide; page numbers in the footer,
//   PDF bookmarks, clickable links, tables kept whole on one page;
// - kak-razrabotat-onlajn-kurs-cover.jpg: page 1 rasterized, for /free/.
// The page count and the file size shown on /free/ are read from the PDF at
// build time (src/components/free/FreeItem.astro), so after a rebuild only
// the «PDF, N страниц» line in pages/free.md may need a new number.
//
// Needs Chromium at /opt/pw-browsers/chromium (CHROMIUM_PATH overrides; no
// browser download) and pdfinfo, pdffonts, pdftoppm from poppler-utils.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { markdownToHtml } from 'satteri';

const ROOT = resolve(import.meta.dirname, '..');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SITE_URL = 'https://imevstratov-pixel.github.io/portfolio/';
const UTM = 'utm_source=guide-pdf&utm_medium=pdf';
const SLUG = 'kak-razrabotat-onlajn-kurs';
const OUT_DIR = join(ROOT, 'public', 'free');
const PDF_OUT = join(OUT_DIR, `${SLUG}.pdf`);
const COVER_OUT = join(OUT_DIR, `${SLUG}-cover.jpg`);
// cover image: longest side in px (A4 portrait, so about 778 x 1100)
const COVER_PX = 1100;

// The cover. Its words come from the guide's own first lines. The number of
// steps of each stage is counted from the draft (stageSteps below), not typed.
const COVER = {
  label: 'Бесплатное руководство',
  forWhom: 'Для онлайн-школ, EdTech-команд, корпоративных академий, основателей и начинающих методистов',
  stages: [
    { name: 'Предпродакшн', text: 'исследование, программа и логика обучения' },
    { name: 'Продакшн', text: 'тексты, видео, задания' },
    { name: 'Постпродакшн', text: 'метрики, интервью с учениками и правки' },
  ],
  author: 'Даниил Евстратов',
  role: 'методолог образовательных продуктов',
};
// All steps of the three stages. The site says «21 шаг» (pages home,
// services and free in the content): when the draft gets another number of
// steps the build stops, so the site texts and this number change together.
const TOTAL_STEPS = 21;
const CONTENTS_HEADING = 'Содержание';
// Parts that start on a new page (h2 texts, start of the heading).
const PAGE_BREAK_BEFORE = ['Из каких этапов', 'Предпродакшн', 'Четыре идеи', 'Что почитать'];
const META = {
  Title: 'Как разработать онлайн-курс',
  Author: 'Даниил Евстратов',
  Subject: `Руководство: ${TOTAL_STEPS} ${stepsWord(TOTAL_STEPS)} разработки онлайн-курса, от разбора конкурентов до первых метрик после запуска`,
  Keywords: 'онлайн-курс, разработка курса, методология, методист, EdTech, карта навыков, LX, CustDev',
};

/** «шаг», «шага» or «шагов» after a number. */
function stepsWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'шаг';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'шага';
  return 'шагов';
}

/* ------------------------------------------------------------- source */

const srcPath = process.argv[2] || process.env.GUIDE_SRC;
if (!srcPath) {
  console.error('usage: node tools/build-guide-pdf.mjs <guide draft .md>   (or GUIDE_SRC=...)');
  process.exit(2);
}
const draft = readFileSync(resolve(srcPath), 'utf8');
const cut = draft.search(/^#\s+Для Даниила/m);
let md = (cut >= 0 ? draft.slice(0, cut) : draft).replace(/\n-{3,}\s*$/, '\n').trim() + '\n';
md = md.replaceAll('[адрес сайта]', `[${SITE_URL}](${SITE_URL})`);

const problems = [];
if (/Для Даниила|не публиковать|<!--|\bTODO\b/i.test(md)) problems.push('internal notes left in the public part');
// a [placeholder] that is not a link
for (const m of md.matchAll(/\[([^\]\n]+)\](?!\()/g)) problems.push(`placeholder left: [${m[1]}]`);

// Steps per stage, counted from the draft: the numbered h3 steps of
// «## Предпродакшн…», the items of the first numbered list of «## Продакшн…»
// and of «## Постпродакшн…» (before their first h3).
function section(name) {
  const m = new RegExp(`^## ${name}[:\\s].*$`, 'm').exec(md);
  if (!m) return null;
  const after = md.slice(m.index + m[0].length);
  const end = after.search(/^## /m);
  return end >= 0 ? after.slice(0, end) : after;
}
function firstListItems(text) {
  let n = 0;
  for (const line of text.split(/^### /m)[0].split('\n')) {
    if (/^\d+\.\s/.test(line)) n++;
    else if (n && line.trim() !== '' && !/^\s/.test(line)) break; // the list ended
  }
  return n;
}
const stageSteps = COVER.stages.map((st) => {
  const text = section(st.name);
  if (text === null) {
    problems.push(`no section «## ${st.name}…» to count its steps`);
    return 0;
  }
  return st.name === 'Предпродакшн' ? (text.match(/^### \d+\.\s/gm) ?? []).length : firstListItems(text);
});
stageSteps.forEach((n, i) => {
  if (!n) problems.push(`no steps found in «${COVER.stages[i].name}»`);
});
const counted = stageSteps.reduce((a, b) => a + b, 0);
if (counted !== TOTAL_STEPS) {
  problems.push(
    `the draft has ${counted} steps (${stageSteps.join(' + ')}), the site says ${TOTAL_STEPS}: ` +
      `fix «${TOTAL_STEPS} шаг» in pages home, services and free, then TOTAL_STEPS here`,
  );
}
COVER.stages.forEach((st, i) => {
  st.value = String(stageSteps[i]);
  st.unit = stepsWord(stageSteps[i]);
});

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

/* ------------------------------------------------------------ markdown */

const { html: raw } = markdownToHtml(md, { features: { gfm: true, smartPunctuation: false } });

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textOf = (h) =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

// Russian typesetting without changing words: a non-breaking space after one-
// and two-letter words, before a dash and between a number and the next word.
function typeset(text) {
  let t = text;
  for (let i = 0; i < 2; i++) t = t.replace(/(^|[\s(«„"\u00a0])([A-Za-zА-Яа-яЁё]{1,2}) (?=\S)/gu, '$1$2\u00a0');
  t = t.replace(/ (—|–)(?=\s)/g, '\u00a0$1');
  t = t.replace(/(\d) (?=[A-Za-zА-Яа-яЁё%₽×])/gu, '$1\u00a0');
  return t;
}
// apply to text between tags only (attributes and URLs stay as they are); a
// range of numbers («pp. 1–15», «3–5») does not break over two lines
const typesetHtml = (h) =>
  h.replace(/(^|>)([^<]+)(?=<|$)/g, (_, a, t) => a + typeset(t).replace(/\d+–\d+/g, '<span class="nw">$&</span>'));

let html = raw;

// the h1 goes on the cover
const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
if (!h1) throw new Error('the guide has no "# " title');
const title = textOf(h1[1]);
html = html.replace(h1[0], '');

// links: full URLs only; the site gets UTM tags
const badLinks = [];
html = html.replace(/<a href="([^"]*)"/g, (_, href) => {
  const h = href.replace(/&amp;/g, '&');
  if (!/^(https?:\/\/|mailto:)/.test(h)) badLinks.push(h);
  let out = h;
  if (h.startsWith(SITE_URL)) {
    const [base, hash = ''] = h.split('#');
    out = `${base}${base.includes('?') ? '&' : '?'}${UTM}${hash ? `#${hash}` : ''}`;
  }
  return `<a href="${escapeHtml(out)}"`;
});
if (badLinks.length) throw new Error(`links must be full URLs: ${badLinks.join(', ')}`);

// headings: ids for the contents and bookmarks; the step number of an h3
// («1. Изучите…») in small mono, as the numbered lists on the site
const parts = [];
let h2i = 0;
let h3i = 0;
html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
  const id = `part-${++h2i}`;
  const text = textOf(inner);
  const brk = PAGE_BREAK_BEFORE.some((p) => text.startsWith(p));
  parts.push({ id, text });
  return `<h2 id="${id}"${brk ? ' class="new-page"' : ''}>${inner}</h2>`;
});
html = html.replace(/<h3>(\d+)\.\s+([\s\S]*?)<\/h3>/g, (_, n, inner) => {
  h3i++;
  return `<h3 class="step" id="step-${n}"><span class="step__n">${n}</span><span class="step__t">${inner}</span></h3>`;
});

// tables: a wrapper that keeps a table on one page; columns with numbers only
// are set in mono and aligned right
html = html.replace(/<table>([\s\S]*?)<\/table>/g, (_, inner) => {
  const rows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => textOf(c[1])));
  const body = rows.slice(1);
  const cols = rows[0]?.length ?? 0;
  const numeric = new Set();
  for (let j = 0; j < cols; j++) if (body.length && body.every((r) => /^\d+(?:[–-]\d+)?$/.test(r[j] ?? ''))) numeric.add(j);
  let fixed = inner;
  if (numeric.size) {
    fixed = fixed.replace(/<tr>([\s\S]*?)<\/tr>/g, (_, cells) => {
      let j = -1;
      return `<tr>${cells.replace(/<(t[dh])>/g, (m, tag) => (numeric.has(++j) ? `<${tag} class="num">` : m))}</tr>`;
    });
  }
  return `<div class="table"><table class="cols-${cols}">${fixed}</table></div>`;
});

// keep the line that introduces a table or a list with it; the colon or the
// full stop may sit inside closing inline tags (a bold label «**Логика
// программы:**» is <p><strong>Логика программы:</strong></p>)
html = html.replace(
  /<p>((?:(?!<\/p>)[\s\S])*?[:.](?:<\/(?:strong|em|b|i)>)*)<\/p>\s*(?=<(?:div class="table"|ul|ol))/g,
  '<p class="lead-in">$1</p>\n',
);

html = typesetHtml(html);

// a link whose text is an address («doi.org/…», «imevstratov-pixel.github.io/…»)
// stays on one line instead of breaking at its hyphen
html = html.replace(/<a href="([^"]*)">([^<]*[a-z0-9]\.[a-z]{2,}[^<]*)<\/a>/g, '<a class="url" href="$1">$2</a>');

// the intro (before the first h2) goes on page 2 with the contents
const firstH2 = html.indexOf('<h2');
const intro = html.slice(0, firstH2).trim();
const rest = html.slice(firstH2).trim();

/* ------------------------------------------------------------ document */

const css = (file) => readFileSync(join(ROOT, 'node_modules', file), 'utf8');
const tokens = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8').replace(/@media[\s\S]*$/, '');

// @font-face rules of the site's faces (Latin and Cyrillic subsets), woff2 inlined
function fontFaces(pkg, file) {
  const dir = join(ROOT, 'node_modules', '@fontsource', pkg, 'files');
  return css(`@fontsource/${pkg}/${file}`)
    .split(/(?=\/\* )/)
    .filter((b) => /-(latin|latin-ext|cyrillic|cyrillic-ext)-\d+-(normal|italic) \*\//.test(b))
    .map((b) =>
      b.replace(/src:[^;]+;/, (src) => {
        const name = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
        const data = readFileSync(join(dir, name)).toString('base64');
        return `src: url(data:font/woff2;base64,${data}) format('woff2');`;
      }),
    )
    .join('\n');
}
const fonts = [
  fontFaces('inter-tight', '400.css'),
  fontFaces('inter-tight', '700.css'),
  fontFaces('inter-tight', '400-italic.css'),
  fontFaces('ibm-plex-mono', '400.css'),
].join('\n');

const siteLabel = SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '');
const siteHref = `${SITE_URL}?${UTM}`;

function documentHtml(pageOf) {
  const contents = parts
    .map(
      (p) =>
        `<li><a href="#${p.id}"><span class="toc__t">${escapeHtml(typeset(p.text))}</span><span class="toc__n">${pageOf?.[p.id] ?? '00'}</span></a></li>`,
    )
    .join('\n');
  const stages = COVER.stages
    .map(
      (s) =>
        `<li><p class="stage__v"><span class="stage__n">${s.value}</span> <span class="stage__u">${s.unit}</span></p><p class="stage__name">${s.name}</p><p class="stage__text">${typeset(s.text)}</p></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="author" content="${escapeHtml(COVER.author)}">
<style>
${fonts}
${tokens}
${PRINT_CSS}
</style>
</head>
<body>
<section class="cover">
  <p class="cover__label">${COVER.label}</p>
  <div class="cover__main">
    <h1 class="cover__title">${escapeHtml(typeset(title))}</h1>
    <p class="cover__for">${escapeHtml(typeset(COVER.forWhom))}</p>
  </div>
  <ol class="cover__stages" role="list">${stages}</ol>
  <div class="cover__foot">
    <p><strong>${COVER.author}</strong><br>${COVER.role}</p>
    <p class="cover__site"><a href="${escapeHtml(siteHref)}">${siteLabel}</a></p>
  </div>
</section>
<section class="intro">
${intro}
<nav class="toc" aria-label="${CONTENTS_HEADING}">
<h2 class="toc__h">${CONTENTS_HEADING}</h2>
<ol role="list">
${contents}
</ol>
</nav>
</section>
<main class="guide">
${rest}
</main>
</body>
</html>`;
}

const PRINT_CSS = `
@page {
  size: A4;
  margin: 18mm 20mm 20mm 20mm;
  @bottom-left {
    content: '${COVER.author}. ${title}';
    font: 400 7.5pt/1 'IBM Plex Mono', monospace;
    color: #5e5e5e;
    vertical-align: top;
    padding-top: 6mm;
  }
  @bottom-right {
    content: counter(page);
    font: 400 7.5pt/1 'IBM Plex Mono', monospace;
    color: #000;
    vertical-align: top;
    padding-top: 6mm;
  }
}
@page :first {
  margin: 0;
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 10.5pt;
  line-height: 1.5;
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  orphans: 3;
  widows: 3;
}
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.5pt; text-underline-offset: 1.6pt; }
a.url, .nw { white-space: nowrap; }
strong { font-weight: var(--bold); }
p, li { text-wrap: pretty; }
h1, h2, h3 { font-weight: var(--bold); text-wrap: balance; break-after: avoid; }

/* cover: the whole first page */
.cover {
  height: 296mm;
  padding: 18mm 20mm 18mm 20mm;
  display: flex;
  flex-direction: column;
  break-after: page;
  overflow: clip;
}
.cover__label, .label { font-family: var(--font-mono); font-size: 8pt; line-height: 1.45; color: var(--muted); }
.cover__main { margin-top: 52mm; }
.cover__title { font-size: 46pt; line-height: 0.96; letter-spacing: -0.032em; word-spacing: 0.1em; max-width: 150mm; }
.cover__for { margin-top: 10mm; font-size: 14pt; line-height: 1.3; letter-spacing: -0.01em; max-width: 128mm; }
.cover__stages {
  list-style: none;
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 6mm;
}
.cover__stages li { border-top: var(--line); padding-top: 3mm; }
.stage__v { font-family: var(--font-mono); line-height: 1; }
.stage__n { font-size: 28pt; letter-spacing: -0.02em; }
.stage__u { font-size: 9pt; }
.stage__name { margin-top: 3mm; font-weight: var(--bold); font-size: 10.5pt; }
.stage__text { font-size: 9pt; line-height: 1.4; color: var(--muted); }
.cover__foot {
  margin-top: 14mm;
  border-top: var(--line);
  padding-top: 3mm;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  font-size: 10.5pt;
  line-height: 1.4;
}
.cover__site { font-family: var(--font-mono); font-size: 9pt; }

/* page 2: who it is for, what is inside, about me, the contents */
.intro > p:first-child { font-size: 13.5pt; line-height: 1.35; letter-spacing: -0.01em; max-width: 150mm; }
.intro > * + * { margin-top: 3.2mm; }
.intro > p:first-child + * { margin-top: 6mm; }
.toc { margin-top: 12mm; }
.toc__h { font-size: 20pt; line-height: 1.06; letter-spacing: -0.022em; border-top: var(--line); padding-top: 2.5mm; }
.intro .toc ol { list-style: none; margin-top: 5mm; border-top: var(--hair); max-width: none; }
.toc li { border-bottom: var(--hair); }
.toc a { display: flex; justify-content: space-between; align-items: baseline; gap: 8mm; padding: 2mm 0; text-decoration: none; }
.toc__n { font-family: var(--font-mono); font-size: 9pt; }

/* the guide */
.guide > * + *, .intro > * + * { margin-top: 3.2mm; }
.guide h2 {
  font-size: 20pt;
  line-height: 1.06;
  letter-spacing: -0.022em;
  border-top: var(--line);
  padding-top: 2.5mm;
  margin-top: 11mm;
  margin-bottom: 5mm;
  max-width: 160mm;
}
.guide h2.new-page { break-before: page; margin-top: 0; }
.guide > h2:first-child { margin-top: 0; }
.guide h3 {
  font-size: 12.5pt;
  line-height: 1.2;
  letter-spacing: -0.01em;
  margin-top: 8mm;
  max-width: 150mm;
}
.guide h2 + h3 { margin-top: 0; }
.step { display: grid; grid-template-columns: 9mm minmax(0, 1fr); align-items: baseline; }
.step__n { font-family: var(--font-mono); font-weight: var(--regular); font-size: 9pt; color: var(--muted); }
.guide h3 + *, .guide h2 + * { margin-top: 2.5mm; }
.guide p, .guide ul, .guide ol, .intro ul, .intro ol, .intro p, .guide blockquote { max-width: 150mm; }
.lead-in { break-after: avoid; }
/* a list does not leave its last item alone at the top of a page */
.guide li:last-child:not(:first-child) { break-before: avoid; }

ul, ol { list-style: none; }
ul > li, ol > li { position: relative; padding-left: 6mm; }
li + li { margin-top: 1.2mm; }
ul > li::before { content: '—'; position: absolute; left: 0; color: var(--muted); }
ol { counter-reset: n; }
ol > li { counter-increment: n; }
ol > li::before { content: counter(n); position: absolute; left: 0; top: 0.2em; font-family: var(--font-mono); font-size: 8pt; color: var(--muted); }
.cover__stages > li::before, .toc li::before { content: none; }
.cover__stages > li, .toc li { padding-left: 0; margin-top: 0; }

blockquote { border-left: var(--line); padding-left: 4mm; break-inside: avoid; }
blockquote > * + * { margin-top: 2mm; }

.table { break-inside: avoid; margin-top: 4mm; }
.guide .table + * { margin-top: 4mm; }
table { width: 100%; border-collapse: collapse; font-size: 8.75pt; line-height: 1.35; }
th {
  font-family: var(--font-mono);
  font-weight: var(--regular);
  font-size: 7.5pt;
  line-height: 1.3;
  color: var(--muted);
  text-align: left;
  vertical-align: bottom;
  padding: 0 3mm 1.6mm 0;
  border-bottom: var(--line);
}
td { vertical-align: top; padding: 1.6mm 3mm 1.6mm 0; border-bottom: var(--hair); }
th:last-child, td:last-child { padding-right: 0; }
tr { break-inside: avoid; }
td.num, th.num { text-align: right; font-family: var(--font-mono); font-size: 8pt; }
td.num { padding-top: 1.85mm; }
table.cols-3 td:first-child { width: 22%; font-weight: var(--bold); }
table.cols-5 td:first-child { width: 36%; }
`;

/* --------------------------------------------------------------- print */

const tools = ['pdfinfo', 'pdffonts', 'pdftoppm'];
for (const t of tools) {
  try {
    execFileSync(t, ['-v'], { stdio: 'ignore' });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${t} not found: install poppler-utils`);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'guide-pdf-'));
const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  const page = await browser.newPage();

  async function render(pageOf) {
    await page.setContent(documentHtml(pageOf), { waitUntil: 'load' });
    const missing = await page.evaluate(async () => {
      await document.fonts.ready;
      const want = ["400 12px 'Inter Tight'", "700 12px 'Inter Tight'", "400 12px 'IBM Plex Mono'"];
      const out = [];
      for (const f of want) if (!(await document.fonts.load(f, 'Аа')).length) out.push(f);
      return out;
    });
    if (missing.length) throw new Error(`fonts not loaded: ${missing.join(', ')}`);
    return Buffer.from(await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true }));
  }

  // pages of the parts, from the named destinations of the contents links
  function destPages(pdf) {
    const file = join(tmp, 'pass.pdf');
    writeFileSync(file, pdf);
    const out = execFileSync('pdfinfo', ['-dests', file], { encoding: 'utf8' });
    const map = {};
    for (const line of out.split('\n')) {
      // «   4 [ XYZ    0  842 null      ] "part-2"»
      const m = line.match(/^\s*(\d+)\s+\[[^\]]*\]\s+"([^"]+)"\s*$/);
      if (m) map[m[2]] = Number(m[1]);
    }
    return map;
  }

  const first = destPages(await render(null));
  const missingParts = parts.filter((p) => !first[p.id]).map((p) => p.id);
  if (missingParts.length) throw new Error(`no page found for ${missingParts.join(', ')}`);
  let pdf = await render(first);
  const check = destPages(pdf);
  const moved = parts.filter((p) => check[p.id] !== first[p.id]).map((p) => p.text);
  if (moved.length) throw new Error(`contents page numbers moved on the second pass: ${moved.join('; ')}`);

  pdf = setInfo(pdf, META);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(PDF_OUT, pdf);

  // cover image: page 1
  const stem = join(tmp, 'cover');
  execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-jpeg', '-jpegopt', 'quality=88,progressive=y', '-scale-to', String(COVER_PX), PDF_OUT, stem]);
  writeFileSync(COVER_OUT, readFileSync(`${stem}.jpg`));

  // report
  const info = execFileSync('pdfinfo', [PDF_OUT], { encoding: 'utf8' });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  const fontsReport = execFileSync('pdffonts', [PDF_OUT], { encoding: 'utf8' });
  const fontRows = fontsReport.split('\n').slice(2).filter(Boolean);
  // columns: name, type, encoding, emb, sub, uni, object, ID
  const notEmbedded = fontRows.filter((r) => r.match(/(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/)?.[1] !== 'yes');
  const families = [...new Set(fontRows.map((r) => r.split(/\s+/)[0].replace(/^[A-Z]{6}\+/, '')))];
  // one link broken over two lines has two link areas: count addresses
  const uris = new Set(pdf.toString('latin1').match(/\/URI\s*\((?:\\.|[^\\)])*\)/g) ?? []).size;
  console.log(`wrote ${PDF_OUT}`);
  console.log(`  ${pages} pages, ${(statSync(PDF_OUT).size / 1024).toFixed(0)} KB, ${uris} addresses linked`);
  console.log(`  contents: ${parts.map((p) => `${first[p.id]} ${p.text}`).join(' | ')}`);
  console.log(`  steps: ${COVER.stages.map((st) => `${st.name} ${st.value}`).join(', ')}, ${counted} in all`);
  console.log(`  lead-in lines kept with their list or table: ${(html.match(/class="lead-in"/g) ?? []).length}`);
  console.log(`  fonts: ${families.join(', ')}${notEmbedded.length ? `; NOT EMBEDDED: ${notEmbedded.join(' / ')}` : ', all embedded'}`);
  console.log(`wrote ${COVER_OUT} (${(statSync(COVER_OUT).size / 1024).toFixed(0)} KB)`);
  if (notEmbedded.length || families.some((f) => !/InterTight|IBMPlexMono/.test(f))) process.exitCode = 1;
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}

/* ---------------------------------------------------------- PDF Info */

// PDF text string as UTF-16BE hex with BOM (safe for Cyrillic).
function pdfString(s) {
  const buf = Buffer.alloc(2 + s.length * 2);
  buf.writeUInt16BE(0xfeff, 0);
  for (let i = 0; i < s.length; i++) buf.writeUInt16BE(s.charCodeAt(i), 2 + i * 2);
  return '<' + buf.toString('hex').toUpperCase() + '>';
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

// Title, Author, Subject, Keywords through a small incremental update (a new
// Info object, xref section and trailer), because Chromium only sets Title.
// The same approach as public/resume/build-ru.cjs.
function setInfo(pdf, meta) {
  const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new Error('startxref not found');
  const prevXref = Number(sx[1]);
  const trailerText = pdf.subarray(prevXref).toString('latin1');
  const size = Number((/\/Size\s+(\d+)/.exec(trailerText) || [])[1]);
  const root = (/\/Root\s+(\d+\s+\d+\s+R)/.exec(trailerText) || [])[1];
  if (!size || !root) throw new Error('could not parse trailer (xref stream PDFs are not supported)');
  const oldInfo = (/\/Info\s+(\d+)\s+\d+\s+R/.exec(trailerText) || [])[1];
  let extra = '';
  if (oldInfo) {
    const m = new RegExp(`(?:^|[\\r\\n])${oldInfo}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(pdf.toString('latin1'));
    if (m) {
      for (const key of ['Creator', 'Producer', 'CreationDate']) {
        const km = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[^>]*>)`).exec(m[1]);
        if (km) extra += `/${key} ${km[1]} `;
      }
    }
  }
  const id = size;
  const fields = Object.entries(meta).map(([k, v]) => `/${k} ${pdfString(v)}`).join(' ');
  const obj = `${id} 0 obj\n<< ${fields} ${extra}/ModDate ${pdfDate(new Date())} >>\nendobj\n`;
  const sep = pdf[pdf.length - 1] === 0x0a ? '' : '\n';
  const objOffset = pdf.length + Buffer.byteLength(sep, 'latin1');
  const xrefOffset = objOffset + Buffer.byteLength(obj, 'latin1');
  const xref =
    `xref\n${id} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size ${id + 1} /Root ${root} /Info ${id} 0 R /Prev ${prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(sep + obj + xref, 'latin1')]);
}
