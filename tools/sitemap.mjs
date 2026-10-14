// Astro integration: dist/sitemap.xml in production builds (PREVIEW=0).
//
// The list comes from the built files, not from a hand-written list: after
// the build every HTML file in dist/ is a candidate, so a new route (a case
// page, /free/ …) lands in the sitemap without touching this file. Left out:
// - 404.html;
// - pages with a robots meta that says noindex (the demo apps carry their
//   own; in production the Astro pages have none unless seo.noindex);
// - redirect stubs (<meta http-equiv="refresh">, e.g. work.html);
// - legacy HTML that no Astro page links to (resume/*.html are the print
//   sources of the PDFs, not pages of the site). The linked ones stay: en/.
// URLs are <site><base><path>: dir/index.html -> dir/, other.html as is.
// Preview builds get no sitemap (robots.txt disallows everything there).
// tools/prodcheck.mjs checks the result.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASTRO = /<meta\s+name="generator"\s+content="Astro/i;
const NOINDEX = /<meta\s[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i;
const REFRESH = /<meta\s[^>]*http-equiv=["']refresh["']/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pathnames of the sitemap (each starts with base), from a built dist/ directory. */
export function sitemapPaths(root, base) {
  const pathOf = (file) => base + relative(root, file).split(sep).join('/').replace(/(^|\/)index\.html$/, '$1');
  const pages = walk(root).map((file) => ({ file, path: pathOf(file), html: readFileSync(file, 'utf8') }));
  const linked = new Set();
  for (const p of pages) {
    if (!ASTRO.test(p.html)) continue;
    const here = new URL(p.path, 'http://site.invalid');
    for (const m of p.html.matchAll(/\shref="([^"#?]*)/g)) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, '&'), here);
        if (u.origin === here.origin) linked.add(u.pathname);
      } catch {}
    }
  }
  return pages
    .filter((p) => !/(^|\/)404\.html$/.test(p.path) && !NOINDEX.test(p.html) && !REFRESH.test(p.html))
    .filter((p) => ASTRO.test(p.html) || linked.has(p.path))
    .map((p) => p.path)
    .sort();
}

export default function sitemap() {
  let site = '';
  let base = '/';
  return {
    name: 'sitemap',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site ?? '';
        base = ('/' + (config.base ?? '/').replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');
      },
      'astro:build:done': ({ dir, logger }) => {
        if ((process.env.PREVIEW ?? '1').trim() !== '0') return;
        if (!site) throw new Error('sitemap: `site` is not set in astro.config');
        const root = fileURLToPath(dir);
        const paths = sitemapPaths(root, base);
        const body =
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          paths.map((p) => `  <url><loc>${xml(new URL(p, site).href)}</loc></url>\n`).join('') +
          '</urlset>\n';
        writeFileSync(join(root, 'sitemap.xml'), body);
        logger.info(`sitemap.xml: ${paths.length} URLs`);
      },
    },
  };
}
