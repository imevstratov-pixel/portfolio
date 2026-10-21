#!/usr/bin/env node
// Link checker over the built site.
//
//   npm run build && npm run check-links
//   DIST=/tmp/x SITE=https://danilevstratov.ru BASE=/ npm run check-links   (a build made with --outDir)
//
// For every HTML file in dist/ (Astro pages and the copied legacy pages):
// - every internal href / src / poster / srcset resolves to a file in dist/
//   (directory links need an index.html; external, mailto:, tel:, data: and
//   javascript: links are skipped);
// - every #anchor exists as an id (or a[name]) on the target page;
// - root-relative links stay inside the base path (BASE, default /portfolio-v2/).
// Hash routes of the demo apps ("#/…") and template placeholders ("${…}") are
// skipped; <script>, <style>, <template> and comments are ignored.
//
// It also checks that the base path is never written by hand: no file in src/
// may contain "/portfolio-v2/", and when BASE is set to anything else the
// built Astro pages must not contain it either.
//
// Expected pages: the routes of the site (/, /services/, /cases/, /products/,
// /free/, /zadachki/, /hire/, /guide/, 404), one page /zadachki/<slug>/ for
// every visible Задачка (each linked from /zadachki/), one page /free/<slug>/
// for every visible free matrix (each linked from /free/), one page /cases/<slug>/ for every published case
// in src/content/cases (slug = file name, decision 17 of 14.10) and one page
// /services/<slug>/ for every service but the guide (SEO plan of 18.10), each
// linked from /services/, must exist;
// /cases/ must link to every case page and keep every case anchor (the old
// links /cases/#case-… land on the case's card); no other page may sit under
// /cases/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = process.env.DIST ? resolve(process.env.DIST) : join(ROOT, 'dist'); // DIST=path to check another build
const BASE = ('/' + (process.env.BASE || '/portfolio-v2/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
const SITE = (process.env.SITE || 'https://imevstratov-pixel.github.io').replace(/\/+$/, '');
const DEFAULT_BASE = '/portfolio-v2/';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ is empty: run `npm run build` first');
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const errors = [];
const err = (file, msg) => errors.push(`${relative(DIST, file).split(sep).join('/')}: ${msg}`);

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function stripNonMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '');
}

const pageCache = new Map();
function page(file) {
  if (pageCache.has(file)) return pageCache.get(file);
  const raw = readFileSync(file, 'utf8');
  const html = stripNonMarkup(raw);
  const ids = new Set();
  for (const m of html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    ids.add(decode(m[1] ?? m[2] ?? m[3]));
  }
  for (const m of html.matchAll(/<a\s[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    ids.add(decode(m[1] ?? m[2]));
  }
  const astro = /<meta\s+name="generator"\s+content="Astro/i.test(raw);
  const info = { raw, html, ids, astro };
  pageCache.set(file, info);
  return info;
}

/** URL path of an HTML file in dist ("services/index.html" -> "/portfolio-v2/services/"). */
function urlOf(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  return BASE + rel.replace(/(^|\/)index\.html$/, '$1');
}

/** dist file for a pathname under BASE, or null. */
function fileFor(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(BASE.length));
  } catch {
    return null;
  }
  const candidates = rel === '' || rel.endsWith('/') ? [rel + 'index.html'] : [rel, rel + '/index.html', rel + '.html'];
  for (const c of candidates) {
    const f = join(DIST, c);
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const SKIP = /^(?:mailto:|tel:|data:|javascript:|blob:|about:)/i;
let checked = 0;

for (const file of htmlFiles) {
  const { html } = page(file);
  const here = new URL(urlOf(file), 'http://site.invalid');
  const refs = [];
  for (const m of html.matchAll(/\s(href|src|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const attr = m[1].toLowerCase();
    const value = decode(m[2] ?? m[3]).trim();
    if (attr === 'srcset') {
      for (const part of value.split(',')) refs.push(part.trim().split(/\s+/)[0]);
    } else refs.push(value);
  }
  // Self-references of the page: canonical, og:url and the preview image
  // (<meta property="og:image" content="https://…/portfolio-v2/assets/og.jpg">).
  // Only these absolute URLs are checked like internal links; any other
  // absolute link is external, even when it shares the host (with BASE=/ the
  // sibling sites imevstratov-pixel.github.io/skrizhal/ start with SITE + BASE).
  const selfRefs = new Set();
  for (const m of html.matchAll(/<link\s[^>]*?rel="canonical"[^>]*?href="([^"]*)"/gi)) selfRefs.add(decode(m[1]).trim());
  for (const m of html.matchAll(/<meta\s[^>]*?property="og:(?:url|image)"[^>]*?content="([^"]*)"/gi)) {
    const v = decode(m[1]).trim();
    selfRefs.add(v);
    refs.push(v);
  }
  for (let ref of refs) {
    if (!ref || ref === '#' || ref.startsWith('#/') || ref.includes('${') || SKIP.test(ref)) continue;
    if (/^https?:\/\//i.test(ref) || ref.startsWith('//')) {
      const abs = ref.startsWith('//') ? 'https:' + ref : ref;
      if (!page(file).astro || !abs.startsWith(SITE + BASE) || !selfRefs.has(ref)) continue;
      ref = abs.slice(SITE.length);
    }
    checked++;
    let target;
    try {
      target = new URL(ref, here);
    } catch {
      err(file, `bad URL "${ref}"`);
      continue;
    }
    if (target.origin !== here.origin) continue;
    const pathname = target.pathname;
    if (!pathname.startsWith(BASE)) {
      err(file, `"${ref}" leaves the base path ${BASE}`);
      continue;
    }
    const dest = fileFor(pathname);
    if (!dest) {
      err(file, `broken link "${ref}"`);
      continue;
    }
    const hash = target.hash.slice(1);
    if (hash && !hash.startsWith('/') && dest.endsWith('.html')) {
      let id;
      try {
        id = decodeURIComponent(hash);
      } catch {
        id = hash;
      }
      const t = page(dest);
      // legacy pages may create anchors with JS; check them only when an Astro page is involved
      const strict = page(file).astro || t.astro;
      if (strict && !t.ids.has(id)) err(file, `missing anchor "#${id}" on ${relative(DIST, dest).split(sep).join('/')}`);
    }
  }
}

// The base path must come from the environment, never from the source.
function scanSource(dir) {
  for (const f of walk(dir)) {
    if (!/\.(astro|ts|js|mjs|css|md|json)$/.test(f)) continue;
    if (readFileSync(f, 'utf8').includes(DEFAULT_BASE)) {
      errors.push(`${relative(ROOT, f)}: hard-coded base path "${DEFAULT_BASE}" (use url() from src/lib/url.ts)`);
    }
  }
}
scanSource(join(ROOT, 'src'));

if (BASE !== DEFAULT_BASE) {
  for (const file of htmlFiles) {
    const p = page(file);
    if (p.astro && p.raw.includes(DEFAULT_BASE)) err(file, `contains "${DEFAULT_BASE}" although BASE=${BASE}`);
  }
}

// Expected pages, read from the content (not from the build).
function frontmatter(file) {
  const m = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const field = (name) => m?.[1].match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
  return { published: field('published'), anchor: field('anchor') };
}
const CASES_DIR = join(ROOT, 'src', 'content', 'cases');
const publishedCases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ slug: f.replace(/\.md$/, ''), ...frontmatter(join(CASES_DIR, f)) }))
  .filter((c) => c.published !== 'false');
// every service but the guide has a page /services/<slug>/ (the guide's is /guide/)
const SERVICES_DIR = join(ROOT, 'src', 'content', 'services');
const pagedServices = readdirSync(SERVICES_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .filter((slug) => slug !== 'guide');
// every visible Задачка has a page /zadachki/<slug>/, linked from /zadachki/;
// every visible free matrix a page /free/<slug>/, linked from /free/
const visibleSlugs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .filter((f) => !/^visible:\s*false\s*$/m.test(readFileSync(join(dir, f), 'utf8').split(/^---$/m)[1] ?? ''))
        .map((f) => f.replace(/\.md$/, ''))
    : [];
const zadachki = visibleSlugs(join(ROOT, 'src', 'content', 'zadachki'));
const matrices = visibleSlugs(join(ROOT, 'src', 'content', 'matrices'));
const expected = [
  '',
  'services/',
  'cases/',
  'products/',
  'free/',
  'hire/',
  'guide/',
  '404.html',
  ...publishedCases.map((c) => `cases/${c.slug}/`),
  ...pagedServices.map((slug) => `services/${slug}/`),
  'zadachki/',
  ...zadachki.map((slug) => `zadachki/${slug}/`),
  ...matrices.map((slug) => `free/${slug}/`),
];
for (const route of expected) {
  if (!fileFor(BASE + route)) errors.push(`expected page ${BASE}${route} was not built`);
}
const servicesIndex = fileFor(BASE + 'services/');
if (servicesIndex) {
  const { html } = page(servicesIndex);
  for (const slug of pagedServices) {
    if (!html.includes(`href="${BASE}services/${slug}/"`)) err(servicesIndex, `no link to the service page ${BASE}services/${slug}/`);
  }
}
const zadachkiIndex = fileFor(BASE + 'zadachki/');
if (zadachkiIndex) {
  const { html } = page(zadachkiIndex);
  for (const slug of zadachki) {
    if (!html.includes(`href="${BASE}zadachki/${slug}/"`)) err(zadachkiIndex, `no link to ${BASE}zadachki/${slug}/`);
  }
}
const freeIndex = fileFor(BASE + 'free/');
if (freeIndex) {
  const { html } = page(freeIndex);
  for (const slug of matrices) {
    if (!html.includes(`href="${BASE}free/${slug}/"`)) err(freeIndex, `no link to ${BASE}free/${slug}/`);
  }
}
const casesIndex = fileFor(BASE + 'cases/');
if (casesIndex) {
  const { html, ids } = page(casesIndex);
  for (const c of publishedCases) {
    if (!html.includes(`href="${BASE}cases/${c.slug}/"`)) err(casesIndex, `no link to the case page ${BASE}cases/${c.slug}/`);
    if (c.anchor && !ids.has(c.anchor)) err(casesIndex, `case anchor "#${c.anchor}" (${c.slug}) is missing: old /cases/#… links would break`);
  }
  const known = new Set(publishedCases.map((c) => c.slug));
  const casesDir = join(DIST, 'cases');
  for (const name of readdirSync(casesDir)) {
    if (statSync(join(casesDir, name)).isDirectory() && !known.has(name)) {
      errors.push(`cases/${name}/: a page for a case that is not published (or not in src/content/cases)`);
    }
  }
}

const astroPages = htmlFiles.filter((f) => page(f).astro).length;
console.log(
  `check-links: ${htmlFiles.length} HTML files (${astroPages} Astro pages, ${publishedCases.length} case, ${pagedServices.length} service, ${zadachki.length} Задачки and ${matrices.length} matrix pages expected), ${checked} internal links, base ${BASE}`,
);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('OK: no broken links or anchors');
