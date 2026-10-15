// Astro integration: in production builds (PREVIEW=0) removes the JS bundles
// that no built file refers to.
//
// Why: /lab/ (src/pages/lab/[...lab].astro) is built only in preview, but
// Astro still bundles the client scripts of every page module, so a
// production dist/ would carry the lab islands' JS in _astro/ with nothing
// loading it. Only .js files under _astro/ are candidates, and one is removed
// only when no .html, .js or .css file in dist/ names it (dynamic imports
// between chunks name the file too, so a chunk that is loaded stays).
// Preview builds are left as they are.
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Removes unreferenced _astro/*.js from a built directory; returns the removed names. */
export function pruneOrphanScripts(root) {
  const astroDir = join(root, '_astro');
  let scripts;
  try {
    scripts = readdirSync(astroDir).filter((n) => n.endsWith('.js'));
  } catch {
    return [];
  }
  const texts = walk(root)
    .filter((f) => /\.(html|js|css)$/.test(f))
    .map((f) => ({ f, text: readFileSync(f, 'utf8') }));
  const removed = [];
  // repeat: removing an orphan can orphan the chunks only it imported
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of scripts) {
      if (removed.includes(name)) continue;
      const self = join(astroDir, name);
      const used = texts.some(({ f, text }) => f !== self && !removed.some((r) => f === join(astroDir, r)) && text.includes(name));
      if (!used) {
        rmSync(self);
        removed.push(name);
        changed = true;
      }
    }
  }
  return removed;
}

export default function labPrune() {
  return {
    name: 'lab-prune',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if ((process.env.PREVIEW ?? '1').trim() !== '0') return;
        const removed = pruneOrphanScripts(fileURLToPath(dir));
        if (removed.length) logger.info(`removed ${removed.length} unreferenced script(s): ${removed.join(', ')}`);
      },
    },
  };
}
