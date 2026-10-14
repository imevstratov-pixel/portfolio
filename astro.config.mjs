// @ts-check
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import legacyPreview from './tools/legacy-preview.mjs';
import sitemap from './tools/sitemap.mjs';

// Deploy target comes from the environment so the same code builds the preview
// (imevstratov-pixel.github.io/portfolio-v2/, PREVIEW=1) and the live site
// (imevstratov-pixel.github.io/portfolio/, PREVIEW=0). The workflow derives
// both from the repository name. This file is the only place where the
// default base is written down.
const SITE = process.env.SITE || 'https://imevstratov-pixel.github.io';
const RAW_BASE = process.env.BASE || '/portfolio-v2/';
const BASE = ('/' + RAW_BASE.replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  // preview builds: noindex and no Metrika in the copied legacy pages too;
  // production builds: sitemap.xml from the built pages
  integrations: [legacyPreview(), sitemap()],
  markdown: {
    syntaxHighlight: false,
    // Approved texts already carry their own typography («», —, non-breaking
    // spaces). Smart punctuation would rewrite quotes and dashes, so it is off.
    processor: satteri({ features: { smartPunctuation: false } }),
  },
});
