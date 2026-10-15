// Astro integration: the staging comment mode (decision 4 of 15.10).
//
// In preview builds (PREVIEW not 0, the sandbox imevstratov-pixel/portfolio-v2)
// and in `npm run dev` it adds one bundled script to every Astro page:
// src/scripts/comment-mode.ts, the floating «Комментировать» button. In
// comment mode a click on any element of the page opens a small form; «Отправить»
// opens a prefilled GitHub issue (label «правка») with the page address, the
// viewport, a CSS selector, the element's text, the nearest heading, data-*
// hints and the source files the element's classes come from. Claude reads
// these issues through GitHub and makes the edits.
//
// Production builds (PREVIEW=0) get nothing: the script is injected only
// here, so neither a page nor a file in dist/ carries it
// (tools/prodcheck.mjs fails otherwise).
//
// Every page loads only the button (src/scripts/comment-mode.ts); the mode
// (src/scripts/comment-mode-ui.ts) and the code map load at the first press.
// Code context: at build time this maps the scoped-style id of every .astro
// file (data-astro-cid-<scope> on each element it renders) to the file, the
// classes the <style> blocks and the stylesheets define to their files, and
// the routes of src/pages to the page files; the map is the virtual module
// virtual:comment-mode-map. The
// repository, the label and the commit (GITHUB_SHA in the workflow, else git)
// go to start() with the base path.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMMENT_MODE_MARKER = 'comment-mode:v1';
const REPO = process.env.COMMENT_REPO || 'imevstratov-pixel/portfolio-v2';
const LABEL = 'правка';
const MAP_ID = 'virtual:comment-mode-map';

const isPreview = () => (process.env.PREVIEW ?? '1').trim() !== '0';

function walk(dir, out = []) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Class names a stylesheet defines: the `.name` tokens of its selectors (not of values like url(x.svg)). */
function definedClasses(css) {
  const out = new Set();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // every "{" closes a selector (or an at-rule prelude); the selector starts
  // after the previous ";", "{" or "}"
  const re = /([^{};]*)\{/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1];
    if (/^\s*@(?!container|media|supports|layer)/.test(sel)) continue;
    for (const c of sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) out.add(c[1]);
  }
  return out;
}

/**
 * Scoped-style ids of the .astro files: Astro marks every element a component
 * renders with data-astro-cid-<scope>, and the scope comes from the file name
 * (the compiler Astro itself uses, @astrojs/compiler-rs). With it an element
 * leads to the exact component that rendered it. Empty when the compiler
 * cannot be loaded (then the classes alone point to the files).
 */
async function scopesOf(root, astroFiles, rel) {
  try {
    const req = createRequire(join(root, 'package.json'));
    const { transform } = await import(pathToFileURL(req.resolve('@astrojs/compiler-rs')).href);
    const out = {};
    for (const f of astroFiles) {
      const r = transform(readFileSync(f, 'utf8'), { filename: f, normalizedFilename: '/' + rel(f) });
      if (r.scope) out[r.scope] = rel(f);
    }
    return out;
  } catch {
    return {};
  }
}

/** The map the client gets: source files, class -> files, scope -> file, routes -> page file. */
export async function buildCodeMap(root) {
  const src = join(root, 'src');
  const rel = (f) => relative(root, f).split(sep).join('/');
  const files = [];
  const classes = {};
  const add = (cls, file) => {
    let i = files.indexOf(file);
    if (i < 0) i = files.push(file) - 1;
    (classes[cls] ??= []).includes(i) || classes[cls].push(i);
  };
  const sources = walk(src).filter((f) => /\.(astro|css)$/.test(f)).sort();
  for (const f of sources) {
    const text = readFileSync(f, 'utf8');
    const css = f.endsWith('.css') ? text : [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join('\n');
    for (const c of definedClasses(css)) add(c, rel(f));
  }
  const scopes = {};
  for (const [scope, file] of Object.entries(await scopesOf(root, sources.filter((f) => f.endsWith('.astro')), rel))) {
    let i = files.indexOf(file);
    if (i < 0) i = files.push(file) - 1;
    scopes[scope] = i;
  }
  // BEM elements and modifiers defined in the same files as their block are
  // left out: the client looks up "svc__more", then "svc"
  for (const c of Object.keys(classes)) {
    const block = c.split(/__|--/)[0];
    if (block !== c && classes[block] && classes[block].join() === classes[c].join()) delete classes[c];
  }
  // routes: src/pages/services/index.astro -> ^/services/$, cases/[slug].astro -> ^/cases/[^/]+/$
  const pagesDir = join(src, 'pages');
  const routes = [];
  for (const f of walk(pagesDir).filter((x) => /\.(astro|ts|js|md)$/.test(x)).sort()) {
    let r = relative(pagesDir, f).split(sep).join('/').replace(/\.(astro|ts|js|md)$/, '');
    const isEndpoint = /\.(ts|js)$/.test(f);
    if (!isEndpoint) r = r === 'index' ? '' : r.replace(/(^|\/)index$/, '') + '/';
    const pattern =
      r === '404/'
        ? '^/404(\\.html|/)?$'
        : '^/' + r.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[[^\]]+\]/g, '[^/]+').replace(/\.(?=[a-z]+$)/, '\\.') + '$';
    let i = files.indexOf(rel(f));
    if (i < 0) i = files.push(rel(f)) - 1;
    routes.push([pattern.replace(/\/\/+/g, '/'), i]);
  }
  // static routes first, so /cases/ wins over /cases/[slug]/
  routes.sort((a, b) => Number(a[0].includes('[^/]+')) - Number(b[0].includes('[^/]+')));
  return { files, classes, scopes, routes };
}

function commit(root) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default function commentMode() {
  return {
    name: 'comment-mode',
    hooks: {
      'astro:config:setup': async ({ config, injectScript, updateConfig, logger }) => {
        if (!isPreview()) return;
        const root = fileURLToPath(config.root);
        const map = await buildCodeMap(root);
        const conf = { marker: COMMENT_MODE_MARKER, repo: REPO, label: LABEL, build: commit(root), base: config.base };
        // the map is a module of its own, loaded with the mode, not with every page
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'comment-mode-map',
                resolveId: (id) => (id === MAP_ID ? '\0' + MAP_ID : undefined),
                load: (id) => (id === '\0' + MAP_ID ? `export default ${JSON.stringify(map)};` : undefined),
              },
            ],
          },
        });
        injectScript(
          'page',
          `import { start } from '/src/scripts/comment-mode.ts';\n` +
            `start(${JSON.stringify(conf)}, () => Promise.all([import('/src/scripts/comment-mode-ui.ts'), import('${MAP_ID}')]));`,
        );
        logger.info(
          `preview: comment mode on every page (${map.files.length} files, ${Object.keys(map.scopes).length} component scopes, ` +
            `${Object.keys(map.classes).length} classes; issues to ${REPO})`,
        );
      },
    },
  };
}
