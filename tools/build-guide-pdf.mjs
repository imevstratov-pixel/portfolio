#!/usr/bin/env node
// The free guides on /free/ as PDF files, plus their cover images. Run by hand
// when a guide text changes; it is not part of the site build. Commit both
// outputs of a guide.
//
//   node tools/build-guide-pdf.mjs course <draft .md>   «Как разработать онлайн-курс»
//   node tools/build-guide-pdf.mjs ai <draft .md>       «AI строит быстро…» (working with an AI agent)
//   node tools/build-guide-pdf.mjs <draft .md>          the first guide, as before (= course)
//   GUIDE_SRC=<draft .md> node tools/build-guide-pdf.mjs [course|ai]
//
// The drafts live outside this repository (their end holds notes for Daniil;
// only the text before «# Для Даниила» is used). The shared engine is
// tools/guide-pdf/engine.mjs, each guide's cover, checks and own blocks are in
// tools/guide-pdf/<guide>.mjs. Output: public/free/<slug>.pdf (A4, black and
// white, the site's fonts embedded, contents with page numbers from a second
// pass, page numbers in the footer, bookmarks, clickable links) and
// public/free/<slug>-cover.jpg (page 1). The page count and the file size
// shown on /free/ are read from the PDF at build time
// (src/components/free/FreeItem.astro), so after a rebuild only the «PDF, N
// страниц» line in pages/free.md may need a new number.
import { buildGuide } from './guide-pdf/engine.mjs';

const GUIDES = { course: './guide-pdf/course.mjs', ai: './guide-pdf/ai.mjs' };

const args = process.argv.slice(2);
let name = 'course';
if (args[0] && GUIDES[args[0]]) name = args.shift();
const src = args[0] || process.env.GUIDE_SRC;
if (!src || (args[0] && !args[0].endsWith('.md'))) {
  console.error(`usage: node tools/build-guide-pdf.mjs [${Object.keys(GUIDES).join('|')}] <draft .md>   (or GUIDE_SRC=...)`);
  process.exit(2);
}
const { default: config } = await import(GUIDES[name]);
await buildGuide(config, src);
