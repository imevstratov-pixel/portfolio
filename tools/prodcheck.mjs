#!/usr/bin/env node
// Deploy-mode check over the built site: preview and production builds must
// differ exactly where they should.
//
//   BASE=/portfolio-v2/ PREVIEW=1 npm run build && npm run leakcheck   (leakcheck runs this)
//   SITE=https://danilevstratov.ru BASE=/ PREVIEW=0 npm run build && npm run leakcheck
//   node tools/prodcheck.mjs [path/to/dist]                            (DIST env works too)
//
// Mode, base and site come from the same env as the build: PREVIEW (on unless
// 0), BASE (default /portfolio-v2/), SITE (default https://imevstratov-pixel.github.io).
// Generated files are the ones that have no copy in public/; everything else
// is a legacy file copied from the old site.
//
// Both modes:
// - every file of public/ is in dist/ (old URLs work.html, en/, demo/, resume/,
//   assets/*.pdf keep working; work.html is generated and must redirect);
// - generated pages other than 404 and redirects: canonical and og:url are
//   SITE + BASE + the page path, og:image is absolute under SITE + BASE and exists;
// - the home page carries the old-anchor map (src/layouts/LegacyAnchors.astro):
//   #hire, #cases, #c1…#c7 lead to built pages (#cN to cases/staff-cN/ while
//   that case is published), #cta, #testimonials, #timeline, #numbers to an
//   anchor or a section heading that exists on the home page.
// Preview (PREVIEW not 0): no Metrika anywhere (mc.yandex.ru, data-metrika),
// a robots noindex meta on every HTML page (search-engine verification files
// google<token>.html and yandex_<token>.html excepted), robots.txt disallows everything
// and names no sitemap, no sitemap.xml; while astro.config.mjs registers the
// staging comment mode (tools/comment-mode.mjs), every generated page
// (redirects excepted) loads it and the chunks it loads later are in dist/.
// Production (PREVIEW=0): the Metrika counter on every generated page
// (redirect stubs excepted), no noindex on them except 404, legacy files
// byte-identical to public/ (en/ keeps its own counter, demo/ its own robots),
// robots.txt allows and names SITE + BASE + sitemap.xml, and sitemap.xml lists
// every indexable generated page (every route, /cases/<slug>/, new ones too)
// plus the linked legacy pages (en/), each once, under SITE + BASE, and
// nothing that is 404, noindex or a redirect. No file of the build carries the
// staging comment mode (its marker, its scripts, the new-issue address), and
// the preview-only /lab/ is absent (no lab/ page, no chunk of its islands).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { VERIFY } from './legacy-preview.mjs';
import { COMMENT_MODE_MARKER } from './comment-mode.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(process.argv[2] || process.env.DIST || join(ROOT, 'dist'));
const PUBLIC = join(ROOT, 'public');
const PREVIEW = (process.env.PREVIEW ?? '1').trim() !== '0';
const BASE = ('/' + (process.env.BASE || '/portfolio-v2/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
const SITE = (process.env.SITE || 'https://imevstratov-pixel.github.io').replace(/\/+$/, '');
const METRIKA_ID = 111316684;
const ORIGIN = SITE + BASE;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`prodcheck: ${DIST} has no index.html, run npm run build first`);
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
const rel = (root, f) => relative(root, f).split(sep).join('/');
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const distFiles = walk(DIST).map((f) => rel(DIST, f));
const publicFiles = new Set(walk(PUBLIC).map((f) => rel(PUBLIC, f)));
const html = new Map(distFiles.filter((f) => f.endsWith('.html')).map((f) => [f, readFileSync(join(DIST, f), 'utf8')]));
const generated = [...html.keys()].filter((f) => !publicFiles.has(f));
const legacy = [...html.keys()].filter((f) => publicFiles.has(f));

/** Site path of a dist file: services/index.html -> <base>services/, work.html -> <base>work.html. */
const pathOf = (f) => BASE + f.replace(/(^|\/)index\.html$/, '$1');
/** dist file for a pathname under BASE, or null (same rules as GitHub Pages and check-links). */
function fileFor(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  const r = decodeURIComponent(pathname.slice(BASE.length));
  for (const c of r === '' || r.endsWith('/') ? [r + 'index.html'] : [r, r + '/index.html', r + '.html']) {
    if (existsSync(join(DIST, c)) && statSync(join(DIST, c)).isFile()) return c;
  }
  return null;
}

const robotsMeta = (h) => h.match(/<meta\s[^>]*name=["']robots["'][^>]*>/i)?.[0] ?? '';
const noindex = (h) => /noindex/i.test(robotsMeta(h));
const isRedirect = (h) => /<meta\s[^>]*http-equiv=["']refresh["']/i.test(h);
const is404 = (f) => /(^|\/)404\.html$/.test(f);
const metaContent = (h, prop) => {
  const m = h.match(new RegExp(`<meta\\s[^>]*property="${prop}"[^>]*content="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : undefined;
};
const canonicalOf = (h) => {
  const m = h.match(/<link\s[^>]*rel="canonical"[^>]*href="([^"]*)"/i);
  return m ? decode(m[1]) : undefined;
};
const hasMetrika = (h) =>
  h.includes('https://mc.yandex.ru/metrika/tag.js') && new RegExp(`ym\\(${METRIKA_ID},\\s*"init"`).test(h);

// ---------------------------------------------------------------- both modes

for (const f of publicFiles) {
  if (!distFiles.includes(f)) err(f, 'is in public/ but not in dist/ (an old URL would break)');
}
const work = html.get('work.html');
if (!work) err('work.html', 'missing (old link to «как я работаю»)');
else if (!isRedirect(work)) err('work.html', 'is not a redirect');
else {
  const to = work.match(/http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i)?.[1];
  const dest = to && fileFor(new URL(decode(to), 'http://x' + BASE).pathname);
  if (!dest) err('work.html', `redirect target "${to}" is not a built page`);
}

for (const f of generated) {
  const h = html.get(f);
  if (is404(f) || isRedirect(h)) continue;
  const want = SITE + pathOf(f);
  const canonical = canonicalOf(h);
  if (canonical !== want) err(f, `canonical "${canonical}" instead of "${want}"`);
  const ogUrl = metaContent(h, 'og:url');
  if (ogUrl !== want) err(f, `og:url "${ogUrl}" instead of "${want}"`);
  const ogImage = metaContent(h, 'og:image');
  if (!ogImage) err(f, 'no og:image');
  else if (!ogImage.startsWith(ORIGIN)) err(f, `og:image "${ogImage}" is not absolute under ${ORIGIN}`);
  else if (!fileFor(new URL(ogImage).pathname)) err(f, `og:image "${ogImage}" is not in dist/`);
}

// old home-page anchors
{
  const home = html.get('index.html');
  const m = home.match(/<script\s[^>]*data-legacy-anchors="([^"]*)"/);
  if (!m) err('index.html', 'no old-anchor script (data-legacy-anchors, src/layouts/LegacyAnchors.astro)');
  else {
    const map = JSON.parse(decode(m[1]));
    const ids = new Set([...home.matchAll(/\sid="([^"]*)"/g)].map((x) => decode(x[1])));
    const headings = [...home.matchAll(/<section\b[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((x) =>
      decode(x[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
    );
    const casesDir = join(ROOT, 'src', 'content', 'cases');
    for (const key of ['hire', 'cases', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'cta', 'testimonials', 'timeline', 'numbers']) {
      if (ids.has(key)) continue; // the new home has this anchor itself
      if (key in map.pages) {
        const to = map.pages[key];
        if (!fileFor(to)) err('index.html', `old anchor #${key} leads to "${to}", which is not a built page`);
        const n = key.match(/^c(\d)$/)?.[1];
        const caseFile = n && join(casesDir, `staff-c${n}.md`);
        const published = caseFile && existsSync(caseFile) && !/^published:\s*false\s*$/m.test(readFileSync(caseFile, 'utf8'));
        const want = published ? `${BASE}cases/staff-c${n}/` : `${BASE}cases/`;
        if (n && to !== want) err('index.html', `old anchor #${key} leads to "${to}" instead of "${want}"`);
        if (key === 'hire' && to !== `${BASE}hire/`) err('index.html', `old anchor #hire leads to "${to}"`);
        if (key === 'cases' && to !== `${BASE}cases/`) err('index.html', `old anchor #cases leads to "${to}"`);
      } else if (key in map.here) {
        const t = map.here[key];
        if (t.id && !ids.has(t.id)) err('index.html', `old anchor #${key} -> #${t.id}, which is not on the home page`);
        if (t.heading && !headings.includes(t.heading.replace(/\s+/g, ' ').trim()))
          err('index.html', `old anchor #${key} -> section «${t.heading}», which is not on the home page`);
      } else err('index.html', `old anchor #${key} is not handled`);
    }
  }
}

// ------------------------------------------------------------------- modes

const robots = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : null;
const sitemapFile = join(DIST, 'sitemap.xml');
if (robots === null) err('robots.txt', 'missing');

if (PREVIEW) {
  for (const f of distFiles) {
    if (!/\.(html|js|css|txt|xml|json|svg)$/.test(f)) continue;
    if (readFileSync(join(DIST, f), 'utf8').includes('mc.yandex.ru')) err(f, 'preview build contains the Yandex Metrika counter');
  }
  for (const [f, h] of html) {
    if (VERIFY.test(f) && publicFiles.has(f)) continue;
    if (!noindex(h)) err(f, 'preview page without <meta name="robots" content="noindex…">');
    if (/\sdata-metrika=/.test(h)) err(f, 'preview page with data-metrika');
  }
  if (robots !== null) {
    if (!/^Disallow:\s*\/\s*$/m.test(robots)) err('robots.txt', 'preview robots.txt must disallow everything');
    if (/^(Allow|Sitemap):/im.test(robots)) err('robots.txt', 'preview robots.txt must not allow or name a sitemap');
  }
  if (existsSync(sitemapFile)) err('sitemap.xml', 'preview build must not have a sitemap');
  // the staging comment mode (when astro.config.mjs registers it): on every
  // generated page, its lazy chunks built
  const commentModeOn = /\bcommentMode\(\)/.test(readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8'));
  if (!commentModeOn) console.log('prodcheck: note, the comment mode (tools/comment-mode.mjs) is not in astro.config.mjs');
  const scriptsOf = (h) => [...h.matchAll(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((x) => fileFor(decode(x[1]))).filter(Boolean);
  const entries = new Set();
  for (const f of commentModeOn ? generated : []) {
    const h = html.get(f);
    if (isRedirect(h)) continue;
    const entry = scriptsOf(h).find((s) => readFileSync(join(DIST, s), 'utf8').includes(COMMENT_MODE_MARKER));
    if (entry) entries.add(entry);
    else err(f, 'preview page without the comment mode (tools/comment-mode.mjs)');
  }
  for (const e of entries) {
    for (const m of readFileSync(join(DIST, e), 'utf8').matchAll(/import\(\s*[`'"](\.\/[^`'"]+\.js)[`'"]\s*\)/g)) {
      const dep = join(e, '..', m[1]).split(sep).join('/');
      if (!existsSync(join(DIST, dep))) err(e, `loads ${m[1]}, which is not in dist/`);
    }
  }
} else {
  for (const f of generated) {
    const h = html.get(f);
    if (isRedirect(h)) {
      if (!noindex(h)) err(f, 'redirect stub without noindex');
      continue;
    }
    if (!hasMetrika(h)) err(f, `no Yandex Metrika counter ${METRIKA_ID}`);
    if (!h.includes(`data-metrika="${METRIKA_ID}"`)) err(f, 'no data-metrika on <html> (Telegram goals)');
    if (is404(f) && !noindex(h)) err(f, '404 must stay noindex');
    if (!is404(f) && robotsMeta(h)) err(f, `production page with a robots meta: ${robotsMeta(h)}`);
  }
  for (const f of distFiles.filter((x) => publicFiles.has(x))) {
    const a = join(DIST, f);
    const b = join(PUBLIC, f);
    const same = /\.(html|js|css|txt|svg|json|cjs)$/.test(f)
      ? readFileSync(a).equals(readFileSync(b))
      : statSync(a).size === statSync(b).size;
    if (!same) err(f, 'legacy file differs from public/ in a production build');
  }
  // the staging comment mode never ships (decision 4 of 15.10)
  const COMMENT = [COMMENT_MODE_MARKER, 'data-comment-mode', 'comment-mode-ui', 'comment-mode-map', '/issues/new'];
  for (const f of distFiles) {
    if (publicFiles.has(f) || !/\.(html|js|mjs|css|txt|xml|json|svg)$/.test(f)) continue;
    const text = readFileSync(join(DIST, f), 'utf8');
    const hit = COMMENT.find((m) => text.includes(m));
    if (hit) err(f, `production build carries the staging comment mode ("${hit}")`);
  }
  // the preview-only /lab/ (decision 3 of 15.10): no page, and no chunk named
  // after its components or scripts (tools/lab-prune.mjs drops them; "core"
  // is too common a chunk name to tell)
  const labModules = ['components/lab', 'scripts/lab']
    .flatMap((d) => (existsSync(join(ROOT, 'src', d)) ? readdirSync(join(ROOT, 'src', d)) : []))
    .map((n) => n.replace(/\.(astro|ts)$/, ''))
    .filter((n) => n !== 'core');
  for (const f of distFiles) {
    if (f.startsWith('lab/')) err(f, 'production build has the preview-only /lab/ page');
    else if (f.startsWith('_astro/') && labModules.some((m) => f.slice('_astro/'.length).startsWith(m + '.')))
      err(f, 'production build carries a script of the preview-only /lab/ (is labPrune() in astro.config.mjs?)');
  }
  if (robots !== null) {
    if (/^Disallow:\s*\/\s*$/m.test(robots)) err('robots.txt', 'production robots.txt disallows everything');
    if (!/^Allow:\s*\/\s*$/m.test(robots)) err('robots.txt', 'production robots.txt has no "Allow: /"');
    if (!robots.includes(`Sitemap: ${ORIGIN}sitemap.xml`)) err('robots.txt', `no "Sitemap: ${ORIGIN}sitemap.xml"`);
  }
  if (!existsSync(sitemapFile)) err('sitemap.xml', 'missing in a production build');
  else {
    const xml = readFileSync(sitemapFile, 'utf8');
    if (!xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) err('sitemap.xml', 'no sitemaps.org <urlset>');
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((x) => decode(x[1]));
    const seen = new Set();
    for (const loc of locs) {
      if (seen.has(loc)) err('sitemap.xml', `duplicate ${loc}`);
      seen.add(loc);
      if (!loc.startsWith(ORIGIN)) {
        err('sitemap.xml', `${loc} is not under ${ORIGIN}`);
        continue;
      }
      const f = fileFor(new URL(loc).pathname);
      if (!f || !f.endsWith('.html')) {
        err('sitemap.xml', `${loc} is not a built page`);
        continue;
      }
      const h = html.get(f);
      if (is404(f) || noindex(h) || isRedirect(h)) err('sitemap.xml', `${loc} is 404, noindex or a redirect`);
      if (generated.includes(f) && canonicalOf(h) !== loc) err('sitemap.xml', `${loc} differs from the page canonical ${canonicalOf(h)}`);
    }
    for (const f of generated) {
      const h = html.get(f);
      if (is404(f) || noindex(h) || isRedirect(h)) continue;
      if (!seen.has(SITE + pathOf(f))) err('sitemap.xml', `misses ${SITE + pathOf(f)}`);
    }
    if (html.has('en/index.html') && !noindex(html.get('en/index.html')) && !seen.has(`${ORIGIN}en/`))
      err('sitemap.xml', `misses the English page ${ORIGIN}en/`);
  }
}

const mode = PREVIEW ? 'preview' : 'production';
console.log(
  `prodcheck: ${mode} build, base ${BASE}, ${generated.length} generated and ${legacy.length} legacy HTML pages` +
    (!PREVIEW && existsSync(sitemapFile) ? `, sitemap ${[...readFileSync(sitemapFile, 'utf8').matchAll(/<loc>/g)].length} URLs` : ''),
);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`OK: ${mode} build is what it should be`);
