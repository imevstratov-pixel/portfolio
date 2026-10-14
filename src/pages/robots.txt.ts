// /robots.txt of the deploy base. Preview (PREVIEW not 0): everything
// disallowed, no sitemap. Production: everything allowed and the sitemap
// (written after the build by tools/sitemap.mjs, production only).
//
// On a GitHub Pages project site this file sits at <site>/<repo>/robots.txt,
// and crawlers read only <site>/robots.txt (the user site repo). So the rules
// that actually work are the robots meta of every page (BaseLayout) and the
// sitemap submitted in Yandex Webmaster and Google Search Console. This file
// starts working as it is if the site ever moves to a domain root.
import type { APIRoute } from 'astro';
import { PREVIEW } from '../lib/env';
import { absoluteUrl } from '../lib/url';

export const GET: APIRoute = ({ site }) => {
  const body = PREVIEW
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('sitemap.xml', site)}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
