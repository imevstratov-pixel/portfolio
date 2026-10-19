// Content access for pages and components.
//
// Everything visible comes from src/content (the sanitized export). This module
// loads every collection once, checks cross-references (the build fails on a
// missing slug or codeword) and offers small lookups that mirror the rules of
// the texts renderer (build_texts.py): what is visible and in which order.
import { getCollection, type CollectionEntry } from 'astro:content';
import { url } from './url';

export type PageEntry = CollectionEntry<'pages'>;
export type CaseEntry = CollectionEntry<'cases'>;
export type ServiceEntry = CollectionEntry<'services'>;
export type ProductEntry = CollectionEntry<'products'>;
export type TestimonialEntry = CollectionEntry<'testimonials'>;
export type ZadachkaEntry = CollectionEntry<'zadachki'>;
export type SiteData = CollectionEntry<'site'>['data'];

/** A page block. Its fields depend on `type`; see docs/components.md. */
export type Block = { id: string; type: string; anchor?: string; [key: string]: any };
export type PageData = PageEntry['data'] & { blocks: Block[]; [key: string]: any };
export type PageId = 'home' | 'services' | 'cases' | 'products' | 'free' | 'hire' | 'guide' | 'zadachki' | '404';

const [pageList, siteList, caseList, serviceList, productList, testimonialList, zadachkaList] = await Promise.all([
  getCollection('pages'),
  getCollection('site'),
  getCollection('cases'),
  getCollection('services'),
  getCollection('products'),
  getCollection('testimonials'),
  getCollection('zadachki'),
]);

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((e) => [e.id, e]));
const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

const PAGES = byId(pageList);
const CASES = byId(caseList);
const SERVICES = byId(serviceList);
const PRODUCTS = byId(productList);
const TESTIMONIALS = byId(testimonialList);

const globalEntry = siteList.find((e) => e.id === 'global');
if (!globalEntry) throw new Error('content: src/content/site/global.md is missing');

/** site/global.md: contacts, header, footer, telegram buttons, email, work terms. */
export const site: SiteData = globalEntry.data;

/* ------------------------------------------------------------------ hidden */

/** Mirrors hidden() in the renderer. The export already drops these; kept as a guard. */
export function isHidden(x: unknown): boolean {
  return !!x && typeof x === 'object' && (x as { status?: unknown }).status === 'hidden';
}

/** Drop hidden items from a list (blocks, FAQ items, rows, notes). */
export function visible<T>(items: T[] | null | undefined): T[] {
  return (items ?? []).filter((x) => !isHidden(x));
}

/* ------------------------------------------------------------------- pages */

export function getPage(id: PageId): PageData {
  const p = PAGES.get(id);
  if (!p) throw new Error(`content: page "${id}" is missing in src/content/pages`);
  return p.data as PageData;
}

/** Visible blocks of a page, in content order. */
export function pageBlocks(page: PageData): Block[] {
  return visible(page.blocks);
}

/** One block by id; throws when it is missing (use findBlock for optional ones). */
export function getBlock(page: PageData, id: string): Block {
  const b = findBlock(page, id);
  if (!b) throw new Error(`content: block "${id}" not found`);
  return b;
}

export function findBlock(page: PageData, id: string): Block | undefined {
  return pageBlocks(page).find((b) => b.id === id);
}

/**
 * Resolve a "global.a.b.c" reference against site/global.md (other values are
 * returned as is). Used by contact blocks: hint, email, lines, workload.
 */
export function gref<T = any>(ref: T): any {
  if (typeof ref === 'string' && ref.startsWith('global.')) {
    let cur: any = site;
    for (const key of ref.split('.').slice(1)) {
      if (cur == null || !(key in cur)) throw new Error(`content: unknown global reference "${ref}"`);
      cur = cur[key];
    }
    return cur;
  }
  return ref;
}

/** Workload line ("Отвечаю в течение дня…") if visible, else null. Mirrors workload_line(). */
export function workloadLine(ref: unknown): string | null {
  const wl = ref ? gref(ref) : null;
  if (wl && typeof wl === 'object' && !isHidden(wl) && typeof wl.text === 'string' && wl.text) return wl.text;
  return null;
}

/* ---------------------------------------------------------------- services */

/** All services in their content order (consulting, ai-agents, audit, course, app, game, guide). */
export const services: ServiceEntry[] = [...serviceList].sort(byOrder);

export function getService(slug: string): ServiceEntry {
  const s = SERVICES.get(slug);
  if (!s) throw new Error(`content: service "${slug}" not found`);
  return s;
}

export function serviceByCodeword(codeword: string): ServiceEntry | undefined {
  return serviceList.find((s) => s.data.codeword === codeword);
}

/** /services/#anchor for a service slug (or entry). */
export function serviceHref(service: string | ServiceEntry): string {
  const s = typeof service === 'string' ? getService(service) : service;
  return url(`/services/#${s.data.anchor}`);
}

/**
 * Services with a page of their own, /services/<slug>/ (SEO plan of 18.10:
 * the list on /services/ stays, each service also gets its page): all but
 * the guide, whose page is /guide/.
 */
export const pagedServices: ServiceEntry[] = services.filter((s) => s.id !== 'guide');

/** The service's own page: /services/<slug>/, or /guide/ for the guide. */
export function servicePageHref(service: string | ServiceEntry): string {
  const s = typeof service === 'string' ? getService(service) : service;
  return s.id === 'guide' ? url('/guide/') : url(`/services/${s.id}/`);
}

const endDot = (t: string) => (/[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** A service price (decision 16 of 14.10): the figure, what it covers, sub-prices. */
export type Price = { main: string; note?: string; more: string[] };

/**
 * The service's own price, or null when it has none (the card then shows the
 * global line site.work.price). Mirrors price_of() in the renderer.
 */
export function servicePrice(service: string | ServiceEntry): Price | null {
  const s = typeof service === 'string' ? getService(service) : service;
  const p = s.data.price;
  const main = p?.main?.trim();
  if (!p || !main) return null;
  return {
    main,
    note: p.note?.trim() || undefined,
    more: visible(p.more ?? []).map((x) => x.trim()).filter(Boolean),
  };
}

/**
 * One-line price as text: «Цена: 70 000–100 000 ₽.» from the service's own
 * price, else the global line with a final period. Mirrors price_line() in the
 * renderer; the components show prices with PriceBlock.
 */
export function servicePriceLine(service: string | ServiceEntry): string {
  const p = servicePrice(service);
  return p ? `Цена: ${endDot(p.main)}` : endDot(site.work.price);
}

/** The global price line («Точную цену называю письменно до старта. …»). */
export function globalPriceLine(): string {
  return endDot(site.work.price);
}

// «12 000 ₽», «от 250 000 ₽», «70 000–100 000 ₽» at the start of a line
// (spaces inside the figure are usually non-breaking).
const LEADING_PRICE = /^((?:от[\s\u00a0]+)?\d[\d\s\u00a0\u202f]*(?:[–-][\s\u00a0]*\d[\d\s\u00a0\u202f]*)?[\s\u00a0\u202f]*₽)[\s\u00a0]*([\s\S]*)$/u;

/**
 * Split a text line that starts with a price into the figure and the rest:
 * «12 000 ₽ за весь тренажёр, без доплат.» -> { main: «12 000 ₽», rest:
 * «за весь тренажёр, без доплат.» }. Null when the line does not start with
 * a figure in roubles. The text itself stays as approved; PriceBlock only
 * sets the figure large (/guide/).
 */
export function splitLeadingPrice(text: string): { main: string; rest: string } | null {
  const m = text.trim().match(LEADING_PRICE);
  return m ? { main: m[1].trim(), rest: m[2].trim() } : null;
}

/** «Срок: около недели.» from the service duration (the renderer's label). */
export function serviceDurationLine(service: string | ServiceEntry): string {
  const s = typeof service === 'string' ? getService(service) : service;
  const d = s.data.duration;
  return `Срок: ${d.charAt(0).toLowerCase()}${d.slice(1)}${/[.!?…]$/.test(d) ? '' : '.'}`;
}

/* ------------------------------------------------------------------- cases */

export function isPublished(slug: string): boolean {
  const c = CASES.get(slug);
  return !!c && c.data.published !== false;
}

/** Published cases sorted by `order` (the order of /cases/). */
export const cases: CaseEntry[] = caseList.filter((c) => c.data.published !== false).sort(byOrder);

export function getCase(slug: string): CaseEntry {
  const c = CASES.get(slug);
  if (!c) throw new Error(`content: case "${slug}" not found`);
  return c;
}

/** Keep only slugs of published cases (renderer: `[c for c in ... if published(c)]`). */
export function publishedCases(slugs: string[] | null | undefined): CaseEntry[] {
  return (slugs ?? []).filter(isPublished).map(getCase);
}

/** Site path of a case page: /cases/<slug>/ (slug = file name). */
export function casePath(c: string | CaseEntry): string {
  const e = typeof c === 'string' ? getCase(c) : c;
  return `/cases/${e.id}/`;
}

/** Link to the case page <base>/cases/<slug>/ (decision 17 of 14.10). */
export function caseHref(c: string | CaseEntry): string {
  return url(casePath(c));
}

/**
 * Link to the case's card on /cases/ (<base>/cases/#anchor). The cards keep
 * the old anchors, so links written before the case pages still land.
 */
export function caseCardHref(c: string | CaseEntry): string {
  const e = typeof c === 'string' ? getCase(c) : c;
  return url(`/cases/#${e.data.anchor}`);
}

/**
 * Words of the case pages and the /cases/ cards. The cases-list block of
 * pages/cases.md may carry them (`cardLink`, `allLink`, `prevLabel`,
 * `nextLabel`, `voicesLabel`, `navLabel`: the name of the bottom navigation
 * with the previous, the next case and «Все кейсы»); until it does, these
 * defaults are used.
 */
export function caseWords(): {
  cardLink: string;
  allLink: string;
  prev: string;
  next: string;
  voices: string;
  nav: string;
} {
  const b = getPage('cases').blocks.find((x) => x.type === 'cases-list') ?? ({} as Block);
  const pick = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  return {
    cardLink: pick(b.cardLink, 'Читать кейс'),
    allLink: pick(b.allLink, 'Все кейсы'),
    prev: pick(b.prevLabel, 'Предыдущий кейс'),
    next: pick(b.nextLabel, 'Следующий кейс'),
    voices: pick(b.voicesLabel, 'Что говорят коллеги'),
    nav: pick(b.navLabel, 'Другие кейсы'),
  };
}

/** Previous and next published case by `order` (null at the ends). */
export function caseNeighbours(c: string | CaseEntry): { prev: CaseEntry | null; next: CaseEntry | null } {
  const e = typeof c === 'string' ? getCase(c) : c;
  const i = cases.findIndex((x) => x.id === e.id);
  return { prev: i > 0 ? cases[i - 1] : null, next: i >= 0 && i < cases.length - 1 ? cases[i + 1] : null };
}

/** The service a case belongs to (cases store the service codeword). */
export function caseService(c: string | CaseEntry): ServiceEntry {
  const e = typeof c === 'string' ? getCase(c) : c;
  const s = serviceByCodeword(e.data.service);
  if (!s) throw new Error(`content: case "${e.id}" has unknown service "${e.data.service}"`);
  return s;
}

export const CASE_LABEL_FIELDS = ['origin', 'industry', 'year', 'duration', 'direction'] as const;

/** Non-empty label values of a case, e.g. ["В штате", "EdTech, …", "2025–2026", "Обучение"]. */
export function caseLabels(c: CaseEntry, fields: readonly string[] = CASE_LABEL_FIELDS): string[] {
  const d = c.data as Record<string, unknown>;
  return fields.map((f) => d[f]).filter((v) => v !== undefined && v !== null && v !== '').map(String);
}

/* ---------------------------------------------------------------- products */

/** Visible products sorted by `order`. */
export const products: ProductEntry[] = productList.filter((p) => p.data.visible !== false).sort(byOrder);

export function getProduct(slug: string): ProductEntry {
  const p = PRODUCTS.get(slug);
  if (!p) throw new Error(`content: product "${slug}" not found`);
  return p;
}

export function isProductVisible(slug: string): boolean {
  const p = PRODUCTS.get(slug);
  return !!p && p.data.visible !== false;
}

/** Keep only visible products, in the given order. */
export function visibleProducts(slugs: string[] | null | undefined): ProductEntry[] {
  return (slugs ?? []).filter(isProductVisible).map(getProduct);
}

export function productHref(p: string | ProductEntry): string {
  const e = typeof p === 'string' ? getProduct(p) : p;
  return url(`/products/#${e.data.anchor}`);
}

/** Message template of a product's quiet link (global productTemplate or its own). */
export function productTemplate(p: ProductEntry): string {
  const t = p.data.messageLink.template;
  return t === 'global.telegram.productTemplate'
    ? site.telegram.productTemplate.replaceAll('{product}', p.data.title)
    : String(gref(t));
}

/* ------------------------------------------------------------ testimonials */

export function getTestimonial(slug: string): TestimonialEntry {
  const t = TESTIMONIALS.get(slug);
  if (!t) throw new Error(`content: testimonial "${slug}" not found`);
  return t;
}

/** "Женя, CPO" / "Лиза, методист, Eduson Academy"; extra parts are appended when new. Mirrors quote_line(). */
export function testimonialSignature(t: TestimonialEntry, extra: Array<string | null | undefined> = []): string {
  const sign: string[] = [t.data.name, t.data.role, t.data.company].filter(Boolean) as string[];
  for (const x of extra) if (x && !sign.includes(x)) sign.push(x);
  return sign.join(', ');
}

/* ---------------------------------------------------------------- telegram */

export type TelegramButtonData = SiteData['telegram']['buttons'][number];

export function telegramButton(codeword: string): TelegramButtonData {
  const b = site.telegram.buttons.find((x) => x.codeword === codeword);
  if (!b) throw new Error(`content: telegram button "${codeword}" not found in site/global.md`);
  return b;
}

export const telegramUrl: string = site.contacts.telegram.url;

/** Single-button hint with the codeword filled in. */
export function singleHint(codeword: string): string {
  return site.telegram.singleHint.replaceAll('{codeword}', codeword);
}

/** mailto: link; subject and body follow global email.mailto ({codeword}, {template}). */
export function mailtoHref(opts: { codeword?: string; template?: string; subject?: string; body?: string } = {}): string {
  const m = site.email.mailto;
  const subject =
    opts.subject ?? (opts.codeword ? m.subject.replaceAll('{codeword}', opts.codeword) : site.email.defaultSubject);
  const body = opts.body ?? (opts.template ? m.body.replaceAll('{template}', opts.template) : '');
  const q = [`subject=${encodeURIComponent(subject)}`];
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${site.contacts.email}?${q.join('&')}`;
}

/* ---------------------------------------------------------------- markdown */

type Rendered = { rendered?: { html: string } };

/** Rendered HTML of an entry's markdown body ('' when the body is empty). */
export function bodyHtml(entry: Rendered): string {
  return entry.rendered?.html?.trim() ?? '';
}

export type Section = { title: string; html: string };

/**
 * Split a body into its "## " sections: [{ title: 'Контекст', html }, …].
 * The h2 tags are removed (pages render their own headings, so the 18 cases on
 * /cases/ do not repeat ids like "контекст"). Text before the first h2 gets
 * title ''. Pass `only` to keep and order specific sections.
 */
export function bodySections(entry: Rendered, only?: string[]): Section[] {
  const html = bodyHtml(entry);
  const out: Section[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/g;
  let last = 0;
  let title = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const chunk = html.slice(last, m.index).trim();
    if (chunk || title) out.push({ title, html: chunk });
    title = m[1].replace(/<[^>]+>/g, '').trim();
    last = re.lastIndex;
  }
  const tail = html.slice(last).trim();
  if (tail || title) out.push({ title, html: tail });
  if (!only) return out;
  return only.map((t) => out.find((s) => s.title === t)).filter((s): s is Section => !!s);
}

/* ------------------------------------------------------------ case texts */

const decodeEntities = (t: string) =>
  t
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Plain text of the first paragraph of an HTML chunk. */
function firstParagraph(html: string): string {
  const m = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/);
  return decodeEntities((m ? m[1] : html).replace(/<[^>]+>/g, '')).replace(/[ \t\r\n]+/g, ' ').trim();
}

/** First sentence of a paragraph (it ends at . ! ? … followed by a capital, a quote or a digit). */
function firstSentence(text: string): string {
  return text.split(/(?<=[.!?…]) +(?=[А-ЯЁA-Z«"0-9])/u)[0]?.trim() ?? '';
}

/**
 * The one line under the infographic on a /cases/ card: the case's own
 * `summary`; else its approved line in the home «featured-cases» block; else
 * the first sentence of «Контекст» (the text as approved, only cut at the
 * sentence end; it often describes the client rather than the work).
 */
export function caseSummary(c: string | CaseEntry): string {
  const e = typeof c === 'string' ? getCase(c) : c;
  if (e.data.summary?.trim()) return e.data.summary.trim();
  const featured = findBlock(getPage('home'), 'featured-cases');
  const homeLine = (featured?.items as Array<{ case: string; line?: string }> | undefined)?.find((it) => it.case === e.id)?.line;
  if (typeof homeLine === 'string' && homeLine.trim()) return homeLine.trim();
  const ctx = bodySections(e, ['Контекст'])[0];
  return ctx ? firstSentence(firstParagraph(ctx.html)) : '';
}

/**
 * Search title and description of a case page: the case's `seo` fields when
 * set; otherwise «<shortTitle> — <site name>» (the full title of 100+
 * characters is cut in search results and fills a Telegram link preview; it
 * stays the h1) and the first sentence of «Контекст»
 * followed by the first sentence of «Результат» (only the first one when both
 * together are longer than 220 characters).
 */
export function caseSeo(c: string | CaseEntry): { title: string; description: string } {
  const e = typeof c === 'string' ? getCase(c) : c;
  const name = e.data.shortTitle?.trim() || e.data.title;
  const title = e.data.seo?.title?.trim() || `${name} — ${site.site.name}`;
  let description = e.data.seo?.description?.trim() || '';
  if (!description) {
    const [ctx, res] = ['Контекст', 'Результат'].map((t) => {
      const sec = bodySections(e, [t])[0];
      return sec ? firstSentence(firstParagraph(sec.html)) : '';
    });
    const both = [ctx, res].filter(Boolean).join(' ');
    description = both.length <= 220 ? both : ctx || res;
  }
  return { title, description };
}

/* ---------------------------------------------------------------- zadachki */

/** The published «Задачки» in their order (SEO plan of 18.10). */
export const zadachki: ZadachkaEntry[] = zadachkaList.filter((z) => z.data.visible !== false).sort(byOrder);

/** /zadachki/<slug>/ */
export function zadachkaHref(z: string | ZadachkaEntry): string {
  return url(`/zadachki/${typeof z === 'string' ? z : z.id}/`);
}

/** The published Задачки that lead to a service (its page lists them). */
export function zadachkiOfService(service: string | ServiceEntry): ZadachkaEntry[] {
  const id = typeof service === 'string' ? service : service.id;
  return zadachki.filter((z) => z.data.service === id);
}

/* ----------------------------------------------------------- content links */

const CASE_BY_ANCHOR = new Map(caseList.map((c) => [c.data.anchor, c]));

/**
 * A link written in the content, through url(). A link to a case card
 * (/cases/#case-…) goes to the case page instead while the case is
 * published (decision 17 of 14.10); every other link is url(href).
 */
export function contentHref(href: string): string {
  const m = href.match(/^\/?cases\/#([^#?\s]+)$/);
  const c = m ? CASE_BY_ANCHOR.get(m[1]) : undefined;
  return c && c.data.published !== false ? caseHref(c) : url(href);
}

/* ------------------------------------------------------- links in a line */

/** A link inside a line of text: its words (`label`) and where they lead. */
export type TextLink = { label: string; service?: string; case?: string; href?: string };
export type TextSegment = { text: string; href?: string };

/**
 * Split a line at the labels of its links, in order, so the labels become
 * links inside the sentence («…, есть консультация и аудит курса.» with links
 * on «консультация» and «аудит курса»). A `service` link goes to the
 * service's card on /services/ (`#anchor` when `servicesPage`, the page
 * itself), a `case` link to the case page while the case is published
 * (otherwise the words stay plain text), an `href` through contentHref().
 * Throws when a label is not in the text. Render with `LinkedText`.
 */
export function linkSegments(
  text: string,
  links: TextLink[] | null | undefined,
  opts: { servicesPage?: boolean; where?: string } = {},
): TextSegment[] {
  const out: TextSegment[] = [];
  let at = 0;
  for (const l of links ?? []) {
    const i = text.indexOf(l.label, at);
    if (i < 0) throw new Error(`content: link "${l.label}" is not in the text${opts.where ? ` of ${opts.where}` : ''}: «${text}»`);
    if (i > at) out.push({ text: text.slice(at, i) });
    const href = l.service
      ? opts.servicesPage
        ? `#${getService(l.service).data.anchor}`
        : servicePageHref(l.service)
      : l.case
        ? isPublished(l.case)
          ? caseHref(l.case)
          : undefined
        : l.href
          ? contentHref(l.href)
          : undefined;
    out.push({ text: l.label, href });
    at = i + l.label.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/* ------------------------------------------------------------- validation */

function validate(): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const codewords = new Set(site.telegram.buttons.map((b) => b.codeword));

  for (const id of ['home', 'services', 'cases', 'products', 'free', 'hire', 'guide', 'zadachki', '404']) {
    need(PAGES.has(id), `page "${id}" is missing`);
  }
  for (const b of site.telegram.buttons) {
    if (b.service) need(SERVICES.has(b.service), `site telegram button "${b.codeword}": unknown service "${b.service}"`);
  }

  // Singular references anywhere inside pages: { case | service | product | testimonial: slug }
  // and lists of codewords under "buttons".
  const keyed: Record<string, Map<string, unknown>> = {
    case: CASES,
    service: SERVICES,
    product: PRODUCTS,
    testimonial: TESTIMONIALS,
  };
  const walk = (x: unknown, where: string) => {
    if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${where}[${i}]`));
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      const at = `${where}.${k}`;
      if (typeof v === 'string' && keyed[k]) need(keyed[k].has(v), `${at}: unknown ${k} "${v}"`);
      else if (k === 'codeword' && typeof v === 'string' && where.includes('button'))
        need(codewords.has(v), `${at}: unknown telegram codeword "${v}"`);
      else if (k === 'button' && typeof v === 'string') need(codewords.has(v), `${at}: unknown telegram codeword "${v}"`);
      else if (k === 'buttons' && Array.isArray(v) && v.every((s) => typeof s === 'string'))
        v.forEach((s, i) => need(codewords.has(s), `${at}[${i}]: unknown telegram codeword "${s}"`));
      else walk(v, at);
    }
  };
  for (const p of pageList) walk(p.data, `pages/${p.id}`);

  // Lists of slugs inside pages, by block type.
  const list = (slugs: unknown, map: Map<string, unknown>, kind: string, at: string) => {
    if (!Array.isArray(slugs)) return;
    slugs.forEach((s, i) => need(typeof s === 'string' && map.has(s), `${at}[${i}]: unknown ${kind} "${s}"`));
  };
  for (const p of pageList) {
    for (const b of (p.data.blocks ?? []) as Block[]) {
      const at = `pages/${p.id}#${b.id}`;
      if (b.type === 'cases') {
        list(b.fallback, CASES, 'case', `${at}.fallback`);
        list(b.returnLine?.cases, CASES, 'case', `${at}.returnLine.cases`);
      }
      if (b.type === 'testimonials') {
        list(b.clients?.items, TESTIMONIALS, 'testimonial', `${at}.clients.items`);
        list(b.colleagues?.items, TESTIMONIALS, 'testimonial', `${at}.colleagues.items`);
      }
      if (b.type === 'intro') list(b.toc?.items, SERVICES, 'service', `${at}.toc.items`);
      if (b.type === 'service-group') list(b.services, SERVICES, 'service', `${at}.services`);
      if (b.type === 'products') list(b.items, PRODUCTS, 'product', `${at}.items`);
      if (b.type === 'cases-toc')
        (b.groups ?? []).forEach((g: any, i: number) => list(g.products, PRODUCTS, 'product', `${at}.groups[${i}].products`));
    }
  }

  for (const s of serviceList) {
    const at = `services/${s.id}`;
    need(codewords.has(s.data.codeword), `${at}: codeword "${s.data.codeword}" has no telegram button`);
    list(s.data.proofCases, CASES, 'case', `${at}.proofCases`);
    list(s.data.proofProducts, PRODUCTS, 'product', `${at}.proofProducts`);
    list(s.data.testimonials, TESTIMONIALS, 'testimonial', `${at}.testimonials`);
    for (const k of Object.keys(s.data.proofNotes ?? {})) need(CASES.has(k), `${at}.proofNotes: unknown case "${k}"`);
    walk({ proofLinks: s.data.proofLinks, related: s.data.related }, at);
  }
  for (const c of caseList) {
    const at = `cases/${c.id}`;
    need(!!serviceByCodeword(c.data.service), `${at}: unknown service codeword "${c.data.service}"`);
    list(c.data.testimonials, TESTIMONIALS, 'testimonial', `${at}.testimonials`);
  }
  for (const z of zadachkaList) {
    const at = `zadachki/${z.id}`;
    need(SERVICES.has(z.data.service) && z.data.service !== 'guide', `${at}: unknown or page-less service "${z.data.service}"`);
    const c = z.data.experience?.case;
    if (c) need(CASES.has(c) && CASES.get(c)!.data.published !== false, `${at}.experience.case: unknown or unpublished case "${c}"`);
    need(/^\d{4}-\d{2}-\d{2}$/.test(z.data.date), `${at}: date "${z.data.date}" is not YYYY-MM-DD`);
  }

  // Anchors must be unique: cases share /cases/, services share /services/, products share /products/.
  for (const [name, entries] of [
    ['cases', caseList],
    ['services', serviceList],
    ['products', productList],
  ] as const) {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const a = (e.data as { anchor: string }).anchor;
      need(!seen.has(a), `${name}/${e.id}: anchor "${a}" already used by ${seen.get(a)}`);
      seen.set(a, e.id);
    }
  }
  return errors;
}

const problems = validate();
if (problems.length) {
  throw new Error(`content: ${problems.length} broken reference(s):\n  - ${problems.join('\n  - ')}`);
}
