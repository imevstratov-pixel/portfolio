// Build mode flags. Read at build time (static output), never shipped as JS.
//
// PREVIEW is on unless the environment says PREVIEW=0. In preview the pages
// carry <meta name="robots" content="noindex,nofollow"> and no analytics.
// Production (PREVIEW=0) adds the Yandex Metrika counter.

export const PREVIEW: boolean = (process.env.PREVIEW ?? '1').trim() !== '0';

export const METRIKA_ID = 111316684;
