// /robots.txt of the deploy base. Preview (PREVIEW not 0): everything
// disallowed, no sitemap. Production: everything allowed and the sitemap
// (written after the build by tools/sitemap.mjs, production only).
//
// The live site sits at the root of its domain (danilevstratov.ru), so
// crawlers read this file and its sitemap line as they are. The staging site
// is a GitHub Pages project site: there the file sits at <site>/<repo>/robots.txt,
// which crawlers do not read, and what keeps it out of search is the robots
// meta of every page (BaseLayout).
import type { APIRoute } from 'astro';
import { PREVIEW } from '../lib/env';
import { absoluteUrl } from '../lib/url';

export const GET: APIRoute = ({ site }) => {
  const body = PREVIEW
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('sitemap.xml', site)}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
