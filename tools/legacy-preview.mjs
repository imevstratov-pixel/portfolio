// Astro integration: preview mode for the legacy pages copied verbatim from
// the old site (public/en/, public/resume/, public/demo/ …).
//
// The Astro pages get noindex and no analytics in preview from BaseLayout.
// The legacy HTML files are copied as they are, so the English page would
// ship the live Yandex Metrika counter and every legacy page could be
// indexed as a duplicate of the live site. In preview (PREVIEW not 0) this
// post-processes every non-Astro .html file in dist/ after the build:
// it removes the Metrika snippet and adds <meta name="robots"
// content="noindex,nofollow"> where there is none. public/ stays untouched;
// production builds (PREVIEW=0) leave the files exactly as copied.
// Search-engine verification files (public/google<token>.html,
// public/yandex_<token>.html) are not pages and stay as they are.
// tools/leakcheck.sh fails if either is still present in a preview build.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRIKA = /[ \t]*<!--\s*Yandex\.Metrika[^>]*-->[\s\S]*?<\/noscript>[ \t]*(?:\r?\n[ \t]*<!--\s*\/Yandex\.Metrika[^>]*-->)?\r?\n?/gi;
const ROBOTS = '<meta name="robots" content="noindex,nofollow">';
export const VERIFY = /(^|[\\/])(google[0-9a-z]+|yandex_[0-9a-z]+)\.html$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

export default function legacyPreview() {
  return {
    name: 'legacy-preview',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if ((process.env.PREVIEW ?? '1').trim() === '0') return;
        const root = fileURLToPath(dir);
        let changed = 0;
        for (const file of walk(root)) {
          if (VERIFY.test(file)) continue;
          const html = readFileSync(file, 'utf8');
          if (/<meta\s+name="generator"\s+content="Astro/i.test(html)) continue;
          let out = html.replace(METRIKA, '');
          if (!/<meta\s[^>]*name=["']robots["']/i.test(out)) {
            out = /<meta\s+charset=[^>]*>/i.test(out)
              ? out.replace(/(<meta\s+charset=[^>]*>)/i, `$1\n  ${ROBOTS}`)
              : out.replace(/(<head[^>]*>)/i, `$1\n  ${ROBOTS}`);
          }
          if (out !== html) {
            writeFileSync(file, out);
            changed++;
          }
        }
        logger.info(`preview: noindex and no analytics in ${changed} legacy page(s)`);
      },
    },
  };
}
