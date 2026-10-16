#!/usr/bin/env node
// Renders the social preview cards (og:image) from the staging page
// /lab/og/<card>/ (src/pages/lab/og/[card].astro) into 1200×630 PNG files.
//
//   npm run build && node tools/og.mjs a b c --out shots/og     (the variants)
//   npm run build && node tools/og.mjs a --to public/assets/og-portrait.png   (the site image)
//
// The site image: a preview build first (the card page exists only there),
// then the render, then `npm run verify` in both modes (the new PNG must be
// in public/ before the build that reads its size into og:image:width/height).
//
// Needs a preview build in dist/ (PREVIEW is on by default; DIST=<dir> for a
// build made with --outDir): the production build has no /lab/. Serves it
// under the base path (BASE, default /portfolio-v2/), opens Chromium from
// /opt/pw-browsers at 1200×630 and one device pixel per CSS pixel, waits
// until every glyph canvas on the card is drawn, then saves the screenshot.
// Greyscale text antialiasing (--disable-lcd-text): LCD antialiasing would
// put coloured pixels on the letter edges of a black-and-white card. PNG, not
// JPEG: one-bit pictures and glyphs are two colours, and JPEG would blur them.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = process.env.DIST ? resolve(process.env.DIST) : join(ROOT, 'dist');
const BASE = ('/' + (process.env.BASE || '/portfolio-v2/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const args = process.argv.slice(2);
let out = join(ROOT, 'shots', 'og');
let to = null;
const cards = [];
const usage = () => {
  console.error('usage: node tools/og.mjs [card ...] [--out dir | --to file.png]');
  process.exit(1);
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' || args[i] === '--to') {
    const value = args[++i];
    if (!value || value.startsWith('--')) usage();
    if (args[i - 1] === '--out') out = resolve(value);
    else to = resolve(value);
  } else if (args[i].startsWith('--')) usage();
  else cards.push(args[i]);
}
if (!cards.length) cards.push('a', 'b', 'c');
if (to && cards.length !== 1) {
  console.error('--to takes one card');
  process.exit(1);
}
if (!existsSync(join(DIST, 'lab', 'og', cards[0], 'index.html'))) {
  console.error(`${relative(ROOT, DIST) || DIST}/lab/og/${cards[0]}/ is missing: run a preview build first (\`npm run build\`, PREVIEW not 0)`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function resolveFile(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  const rel = decodeURIComponent(pathname.slice(BASE.length));
  for (const c of [rel, join(rel, 'index.html')]) {
    const f = join(DIST, c);
    if (relative(DIST, f).split(sep)[0] === '..') return null;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(new URL(req.url, 'http://localhost').pathname);
  if (!file) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--disable-lcd-text'] });
let failed = false;
try {
  for (const card of cards) {
    // reduced motion: the glyphs are drawn once and stay still
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const resp = await page.goto(`${origin}${BASE}lab/og/${card}/`, { waitUntil: 'networkidle' });
    if (!resp || resp.status() !== 200) {
      console.error(`${card}: HTTP ${resp?.status()}`);
      failed = true;
      await page.close();
      continue;
    }
    const states = await page
      .waitForFunction(
        () => {
          const els = [...document.querySelectorAll('[data-ascii-headline], [data-dither-portrait]')];
          return els.length && els.every((el) => el.dataset.state === 'ready' || el.dataset.state === 'failed')
            ? els.map((el) => el.dataset.state)
            : false;
        },
        null,
        { timeout: 15000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    if (!states || states.includes('failed')) {
      console.error(`${card}: the glyphs did not draw (${states ?? 'timeout'})`);
      failed = true;
      await page.close();
      continue;
    }
    const file = to ?? join(out, `og-${card}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exitCode = 1;
