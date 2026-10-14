// The one place where internal links and asset paths get the deploy base.
// Content writes site paths as "/services/#audit", "/demo/wishlist/" or
// "assets/portrait.jpg"; pages and components pass them through url().
// Nothing else in src/ may write the base path by hand.

const RAW_BASE: string = import.meta.env.BASE_URL || '/';

/** The deploy base from astro.config (env BASE), with a leading and a trailing slash. */
export const BASE = ('/' + RAW_BASE.replace(/^\/+|\/+$/g, '') + '/').replace(/\/+/g, '/');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // https:, mailto:, tel:, data:, //cdn

/** True for links that leave the site (http(s), mailto, tel, data, protocol-relative). */
export function isExternal(href: string): boolean {
  return EXTERNAL.test(href);
}

/**
 * Prefix a site path with the deploy base (shown here as <base>/).
 *   url('/')                  -> '<base>/'
 *   url('/cases/#case-team')  -> '<base>/cases/#case-team'
 *   url('assets/og.jpg')      -> '<base>/assets/og.jpg'
 *   url('#contact')           -> '#contact'           (same-page anchor, unchanged)
 *   url('https://t.me/x')     -> 'https://t.me/x'     (external, unchanged)
 *   url(url('/x/'))           -> '<base>/x/'          (idempotent)
 */
export function url(path: string = '/'): string {
  if (!path) return BASE;
  if (path.startsWith('#') || path.startsWith('?') || isExternal(path)) return path;
  if (BASE !== '/' && path.startsWith(BASE)) return path; // already prefixed: url() is idempotent
  return BASE + path.replace(/^\.?\/+/, '');
}

/** Absolute URL on the deployed site (for canonical and Open Graph tags). */
export function absoluteUrl(path: string, site: URL | string | undefined): string {
  const href = url(path);
  if (isExternal(href)) return href;
  return new URL(href, site ?? 'http://localhost').href;
}

/** Same-page anchor href from an id: anchor('contact') -> '#contact'. */
export function anchor(id: string): string {
  return '#' + id.replace(/^#/, '');
}
