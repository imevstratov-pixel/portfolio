// /work.html: the old "how I work" page. Redirects to /services/#formats
// (meta refresh, canonical and a plain link), under any base path.
import type { APIRoute } from 'astro';
import { getPage, getBlock } from '../lib/content';
import { absoluteUrl, url } from '../lib/url';

export const GET: APIRoute = ({ site }) => {
  const formats = getBlock(getPage('services'), 'formats');
  const target = url('/services/#formats');
  const canonical = absoluteUrl('/services/', site);
  const title: string = formats.heading;
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${canonical}">
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p><a href="${target}">${title}</a></p>
</body>
</html>
`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
