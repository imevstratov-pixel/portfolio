#!/usr/bin/env node
// Full-page screenshots of built pages at 375, 768 and 1280 px.
//
//   npm run build && npm run shots -- --out shots/v1 / /services/ /cases/
//   npm run shots -- --out shots/all              (every route, the case pages too)
//   npm run shots -- --widths 360,375 /           (other widths)
//
// Serves dist/ under the base path (BASE, default /portfolio-v2/) with a small
// static server, opens Chromium from /opt/pw-browsers (no browser download),
// scrolls each page once so lazy images load, then saves
// <out>/<route>-<width>.png. Also reports horizontal overflow per width.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const BASE = ('/' + (process.env.BASE || '/portfolio-v2/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const ALL_ROUTES = ['/', '/services/', '/cases/', '/products/', '/free/', '/hire/', '/guide/', '/404.html'];

const args = process.argv.slice(2);
let out = join(ROOT, 'shots');
let widths = [375, 768, 1280];
const routes = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = resolve(args[++i]);
  else if (args[i] === '--widths') widths = args[++i].split(',').map(Number).filter(Boolean);
  else routes.push(args[i]);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ is empty: run `npm run build` first');
  process.exit(1);
}
if (!routes.length) {
  // the case pages /cases/<slug>/ as built
  const casesDir = join(DIST, 'cases');
  const casePages = existsSync(casesDir)
    ? readdirSync(casesDir)
        .filter((n) => existsSync(join(casesDir, n, 'index.html')))
        .sort()
        .map((n) => `/cases/${n}/`)
    : [];
  routes.push(...ALL_ROUTES, ...casePages);
}
mkdirSync(out, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

function resolveFile(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  let rel = decodeURIComponent(pathname.slice(BASE.length));
  if (rel.includes('..')) return null;
  const candidates = [rel, join(rel, 'index.html'), rel + '.html'];
  for (const c of candidates) {
    const f = join(DIST, c);
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = resolveFile(pathname);
  if (!file) {
    const nf = join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    res.end(existsSync(nf) ? readFileSync(nf) : 'not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const slug = (route) =>
  route.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '').replace(/[^a-z0-9-]+/gi, '-') || 'home';

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const problems = [];
try {
  for (const route of routes) {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const target = origin + BASE + route.replace(/^\/+/, '');
      const resp = await page.goto(target, { waitUntil: 'networkidle' });
      if (!resp || (resp.status() >= 400 && !route.includes('404'))) problems.push(`${route}: HTTP ${resp?.status()}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        const step = Math.max(200, window.innerHeight - 100);
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`${route} @${width}px: horizontal overflow ${overflow}px`);
      const file = join(out, `${slug(route)}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\nProblems:\n  ' + problems.join('\n  '));
  process.exitCode = 1;
}
