# portfolio-v2

Daniil Evstratov's portfolio, rebuilt on Astro: a black-and-white static site
(v1). Deployed to GitHub Pages by `.github/workflows/deploy.yml`. The same code
goes to two repositories; the workflow reads the target from the repository:

| Repository | URL | Mode |
| --- | --- | --- |
| `imevstratov-pixel/portfolio-v2` | https://imevstratov-pixel.github.io/portfolio-v2/ | sandbox: `PREVIEW=1`, noindex, no analytics, robots.txt disallows |
| `imevstratov-pixel/portfolio` | https://imevstratov-pixel.github.io/portfolio/ | live: `PREVIEW=0`, Yandex Metrika, indexable, sitemap.xml |

In both repositories Settings → Pages → Source must be «GitHub Actions»
(the deploy step cannot publish otherwise). For `portfolio` this has to be set
before the first push of this code: see the move checklist below.

```sh
npm ci
npm run dev        # http://localhost:4321/portfolio-v2/
npm run verify     # build + link check + internal-notes and deploy-mode check
BASE=/portfolio/ PREVIEW=0 npm run verify   # the same for the live site
npm run shots -- --out shots/now   # screenshots at 375, 768, 1280
node tools/build-guide-pdf.mjs <guide draft .md>   # by hand: the free guide PDF and its cover in public/free/
```

Content in `src/content` is a sanitized export and is not edited by hand.
Components, content fields, CSS classes and tools: [docs/components.md](docs/components.md).

## Moving the live site to this code (decision 20)

`imevstratov-pixel/portfolio` still holds the old site and has no workflow,
so its Pages source is «Deploy from a branch». A push of this code to its
`main` before the switch would publish the repository root at /portfolio/:
README.md as the home page and `src/` in the open. The old site is archived
in `imevstratov-pixel/portfolio-archive`. In this order:

1. In `imevstratov-pixel/portfolio`: Settings → Pages → Source → «GitHub
   Actions». Only then push.
2. Check the exact commit on a clean clone (untracked files in a working tree
   can hide a missing one):
   ```sh
   git clone https://github.com/imevstratov-pixel/portfolio-v2 /tmp/live-check
   cd /tmp/live-check && npm ci && BASE=/portfolio/ PREVIEW=0 npm run verify
   ```
3. Push `main` to `imevstratov-pixel/portfolio` (its own history is the old
   site, so the push replaces it; the archive keeps the old one).
4. The first run of «Deploy to GitHub Pages» there must log
   `Building https://imevstratov-pixel.github.io/portfolio/ with PREVIEW=0`,
   pass build, check-links and leakcheck, and deploy.
5. Open the live site: `/portfolio/`, `/portfolio/#hire` (→ /hire/),
   `/portfolio/#c1` (→ the case page), `/portfolio/work.html`,
   `/portfolio/en/`, `/portfolio/robots.txt`, `/portfolio/sitemap.xml`; the
   visit shows in Yandex Metrika 111316684.
6. Metrika goals: the site sends `telegram`, `email`, `hire`, `product`,
   `download` and `demo` (docs/components.md, section 7). Add each in the
   counter as a JavaScript-event goal with that identifier, or Metrika
   ignores them.
7. Search engines. robots.txt at /portfolio/robots.txt is not read by
   crawlers (they read only the host root), so they learn about the sitemap
   `https://imevstratov-pixel.github.io/portfolio/sitemap.xml` when it is
   submitted:
   - Google Search Console: a URL-prefix property
     `https://imevstratov-pixel.github.io/portfolio/`, verified with an HTML
     file. Put the downloaded `google<token>.html` into `public/` as is,
     commit, push, press «Verify», then submit the sitemap. No code change:
     production keeps the file byte-identical, preview builds leave it alone
     (tools/legacy-preview.mjs, tools/prodcheck.mjs).
   - Yandex Webmaster adds sites by host: `https://imevstratov-pixel.github.io`.
     Its `yandex_<token>.html` goes to the root of the host, which is the
     repository `imevstratov-pixel/imevstratov-pixel.github.io` (create it if
     there is none, Pages from the `main` branch). A `robots.txt` there with
     `Sitemap: https://imevstratov-pixel.github.io/portfolio/sitemap.xml`
     shows the sitemap to every crawler. Then submit the sitemap in Webmaster.
8. After the move: on hh.ru and LinkedIn the portfolio link becomes
   `https://imevstratov-pixel.github.io/portfolio/hire/`.
