# Components and content: reference for page builders

Everything a page needs is described here: commands, the content each page reads,
the helpers, the shared components and the CSS classes. Build pages only from
these pieces; add a new shared piece here when two pages need it.

Stack: Astro 7.3.8 (static output), TypeScript in components, fonts from
@fontsource (Inter Tight 400/700 and 400 italic, IBM Plex Mono 400, Latin and
Cyrillic subsets). Static HTML first, no UI framework; motion (decision 2 of
15.10) from proven libraries: Motion (its WAAPI animate and springs, about
6 KB gzip), Embla Carousel (the shadcn/ui carousel engine), and the browser's
own modal `<dialog>` for the image lightbox. Client scripts: Telegram copy
and analytics goals on every page, the carousel on pages with a Carousel,
the accordions (FAQ, the long disclosures on /services/), the lightbox on
/services/ and /products/ (its code loads at the first use), the glyph
headline and the one-bit portrait on the home page (Canvas 2D, no library;
section 7, docs/lab.md).

## 1. Rules that every page follows

- **Content only from `src/content`.** It is the sanitized export; never edit it by
  hand and never type visitor-facing text into a page. Re-export with
  `SITE_CONTENT=<path to site-content> npm run content` (runs
  `export_public.py`). Labels that the texts renderer adds itself (for example
  «Срок:» before a service duration) are the only exceptions, and they are
  already built into the components.
- **Do not rewrite texts.** Show them exactly as in the content, including
  non-breaking spaces, «», — and the double space in the mother's quote. Smart
  punctuation is off in the markdown pipeline.
- **No hard-coded base path.** Every internal link and asset goes through
  `url()` (section 3). Components that take an `href` or `src` call `url()`
  themselves, so pass content paths as they are (`/services/#audit`,
  `assets/portrait.jpg`). `url()` is idempotent.
- **Black and white.** Use only the tokens (`--ink`, `--paper`, `--muted`,
  `--rule`). No other colours, no rounded corners, shadows or gradients.
  Colour exists only inside media. Emphasis is typographic: the five
  underlines of the school sentence parse (section 6, «Accents», decision 1
  of 15.10), never a colour.
- **Motion (decision 2 of 15.10).** Smooth and native, nothing for show:
  every transition answers an action (hover, press, open, close, swipe,
  page change); nothing loops or moves by itself. Timings and springs live
  in `styles/motion.css` (CSS) and `scripts/accordion.ts` / Motion (JS).
  Everything that moves sits behind `prefers-reduced-motion: no-preference`:
  with «reduce» every change is instant, as before. Hover effects stay
  underline and button inversion (now over a short fade). Underlines and
  their motion belong to the accents (`accents.css`: the wave comes in with
  `u-wave-in` and goes back over `--dur-hover`); `motion.css` never sets
  `text-decoration`, and a component that moves a line of its own (FAQ,
  CaseFull) uses the accents tokens and `u-wave-in`. The canvas islands
  (the glyph h1 of the home hero and the one-bit photo of «Обо мне»,
  decision 6 of 15.10; the prototypes of the preview-only /lab/) follow the
  pointer or a finger and stand still otherwise, still with reduced motion;
  their shimmer at rest stays off (an opt-in for comparison on /lab/ only,
  docs/lab.md).
- **No arrows and no middle dots** anywhere (buttons, labels, lists): use a dash,
  «и», a comma or a step number.
- **The output must pass `npm run leakcheck`.** It greps the built site for
  `hidden`, `_note`, `_todo`, `_draft` and a few slugs. So never use these
  substrings in class names, ids or attributes: no `hidden` attribute, no
  `overflow: hidden` (use `overflow: clip`), no BEM elements like `__note` or
  `__notes` (use `__foot`, `__lines`). The one allowed form is the ARIA
  attribute `aria-hidden="true"`, for a mouse-only duplicate link (the guide
  cover in `LeadMagnet` and `FreeItem`, together with `tabindex="-1"`).
  `.sr-only` exists for screen-reader text.
- **One `<h1>` per page.** Section headings are `h2`, items inside `h3`.
- **Anchors.** Every block with `anchor` in the content must render that id
  (`contact`, `formats`, `faq`, `numbers`, `experience`, …). Services use their
  `anchor` (`consulting`, `ai-agents`, `audit`, `course`, `app`, `game`,
  `guide`) on /services/, cases their `anchor` (`case-…`) on their card on
  /cases/ (so old /cases/#case-… links still land), products their `anchor`
  on /products/. Links to a case go to its page /cases/<slug>/ (`caseHref`).
  Other pages link to these; `check-links` fails when one is missing. Anchors
  sit on elements that are always visible (the case card, the service card),
  never inside a closed `<details>`.
- **Words.** No «Мост» and not the old production-line word for the AI
  service anywhere, in components, comments, drawings and anchors included
  (decisions 2 and 6 of 14.10): the service is «AI-агенты» (codeword
  «AI-агенты», anchor `#ai-agents`, its case `#case-ai-agents`), the drawing
  is AgentsScheme.
- **Images and video.** Fixed aspect ratios (component `Media`), lazy below the
  fold, alt text from the content. Video: native player, `preload="none"`,
  poster, no autoplay, no loop. The `loop` fields in the content are not used.
- **Less text, more pictures (decisions 10 and 17 of 14.10).** The services'
  long texts fold into `Disclosure` («Подробнее», a native `<details>` that
  opens on a spring; while open its «Свернуть» sticks under the header and a second
  «Свернуть», framed like it, closes it from the end). A case does not fold: /cases/ shows
  cards, the full case is its own page /cases/<slug>/. Rows of people or
  screenshots are a `Carousel`.
- **Prices (decision 16 of 14.10).** Always through `PriceBlock` (or
  `ServiceTerms`, which puts it beside «Срок»): one style everywhere, the
  figure in the sans face, regular weight, sized to its context and never
  larger than the title it belongs to (the service title's size on /services/
  cards, home rows and the case page offer; the body size in the small home
  rows; large only in the /guide/ hero), the note under it, the sub-prices as
  a small list; a service without a price shows the global line
  `site.work.price`.
- **A `class` passed to a child component does not get the parent's scoped
  styles.** Astro scopes a component's CSS to the elements it renders itself,
  so `<Resumes class="hero__resumes" />` styled in the parent does nothing.
  Wrap the child in an element of your own (`<div class="hero__resumes">…`)
  and style the wrapper, or use `:global()` on purpose.
- **Empty means absent.** A block, line or media item without content is not
  rendered (no placeholders). `Media` renders nothing for `src: ''`.

## 2. Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at `http://localhost:4321/portfolio-v2/` |
| `npm run build` | Static build into `dist/` |
| `npm run preview` | Serves `dist/` (Astro 7 may start it in the background; stop with `npx astro preview stop`) |
| `npm run check` | `astro check`: TypeScript and template types (0 errors expected) |
| `npm run check-links` | Every internal href/src/poster in `dist/` resolves, every `#anchor` exists on its page, no link leaves the base, no `/portfolio-v2/` literal in `src/`. Absolute URLs count as internal only for the page's own canonical, og:url and og:image; other links to the same host (sibling sites like `/skrizhal/`) are external. Expected pages: every route (/free/ included) and one /cases/<slug>/ per published case in `src/content/cases` must be built, /cases/ must link to each and keep each case anchor, and no other page may sit under /cases/. `DIST=<dir>` checks a build made with `--outDir` |
| `npm run leakcheck` | Greps `dist/` for internal markers (see rules). Legacy files copied from the old site are reported, not failed, for `hidden`/`_note`; `--strict` fails on them too. The client bundles `_astro/*.js` are compiled library code (Motion and Embla use `hidden` as code: `document.hidden`, `overflow: hidden`): in them `hidden` fails only as a content status (`status: "hidden"`), every other marker as anywhere. Fails on any file under `dist/media/` that no generated page references (a screenshot waiting for Daniil's OK must stay outside `public/`). Then runs `tools/prodcheck.mjs` (below) |
| `node tools/prodcheck.mjs [dist]` | Deploy-mode check, run by `leakcheck` with the same `PREVIEW`, `BASE`, `SITE`. Preview: no `mc.yandex.ru` or `data-metrika` anywhere, a robots `noindex` meta on every HTML page (search-engine verification files `google*.html`, `yandex_*.html` from `public/` excepted), robots.txt `Disallow: /` without a sitemap, no sitemap.xml. Production: the Metrika counter and `data-metrika` on every generated page (the work.html redirect excepted), no robots meta except on 404, legacy files byte-identical to `public/`, robots.txt `Allow: /` with `Sitemap: <site><base>sitemap.xml`, sitemap.xml with every indexable generated page and en/ under `<site><base>`, nothing 404, noindex or redirect, no file carrying the staging comment mode (its marker `comment-mode:v1`, `data-comment-mode`, its chunks, `/issues/new`), and no preview-only /lab/ (no `lab/` page, no `_astro` chunk named after a file of `src/components/lab/` or `src/scripts/lab/`, which hold only what /lab/ alone uses; the home page's canvas islands live in `glyphs/`). Preview also, while `astro.config.mjs` registers `commentMode()`: every generated page (redirects excepted) loads the comment mode, and the chunks it loads later exist. Both: every `public/` file is built (old URLs), canonical and og:url are `<site><base><path>`, og:image is absolute and exists, the old home anchors lead to built pages and existing sections |
| `npm run shots -- --out shots/x / /services/` | Full-page screenshots at 375, 768, 1280 (`--widths 360,375` to change), reports horizontal overflow. Without routes: every page, the built case pages too. Uses `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`) and its own static server under the base path |
| `npm run verify` | build, check-links, leakcheck |
| `npm run content` | Re-run the content export (needs `SITE_CONTENT`) |
| `node tools/build-guide-pdf.mjs <guide draft .md>` | Run by hand, not part of the build. Builds the free guide «Как разработать онлайн-курс» for /free/: `public/free/kak-razrabotat-onlajn-kurs.pdf` (A4, black and white, Inter Tight and IBM Plex Mono embedded, colours and font stacks from `tokens.css`; cover, contents with page numbers from a second pass, page numbers in the footer, bookmarks, clickable full-URL links, tables kept on one page, a line ending in «:» or «.» kept with the list or table it introduces, bold labels such as «**Логика программы:**» included, and no list leaving its last item alone at the top of a page; the step counts on the cover are counted from the draft: the numbered h3 steps of «Предпродакшн», the first numbered list of «Продакшн» and of «Постпродакшн», and the build stops unless they add up to `TOTAL_STEPS` (21, the «21 шаг» of pages home, services and free)) and `public/free/kak-razrabotat-onlajn-kurs-cover.jpg` (page 1). Reads only the text before «# Для Даниила» of the draft (kept outside the repository), fails on notes or placeholders left, puts the live address for «[адрес сайта]» and UTM tags (`utm_source=guide-pdf`) on links to the site. Prints pages, size, linked addresses and fonts. Needs `/opt/pw-browsers/chromium` (`CHROMIUM_PATH`) and poppler-utils (`pdfinfo`, `pdffonts`, `pdftoppm`). Commit both files; then check «PDF, N страниц» in `pages/free.md` (the build fails when it differs from the file) |

Environment: `BASE` (default `/portfolio-v2/`), `SITE` (default
`https://imevstratov-pixel.github.io`), `PREVIEW` (on unless `0`). In preview
every page has `noindex,nofollow` and no analytics, the legacy pages too
(`tools/legacy-preview.mjs`, an Astro integration, strips the Metrika snippet
from `dist/en/index.html` and adds the robots meta to legacy pages after the
build; `public/` stays verbatim), and `robots.txt` disallows everything; with
`PREVIEW=0` the Yandex Metrika counter 111316684 is added, `<html
data-metrika>` enables goals, `robots.txt` allows everything and names the
sitemap, and `tools/sitemap.mjs` (an Astro integration) writes
`dist/sitemap.xml` from the built files: every HTML page except 404, noindex
pages (the demo apps), redirect stubs (work.html) and legacy HTML no Astro
page links to (resume/*.html, the PDF sources); en/ is in. A new route lands
in the sitemap by itself.
Test another base with `BASE=/x/ npm run build && BASE=/x/ npm run check-links`.

Deploy (`.github/workflows/deploy.yml`): one code base, two repositories. The
workflow sets `BASE=/<repository name>/` and `PREVIEW=0` only in
`imevstratov-pixel/portfolio` (the live site
https://imevstratov-pixel.github.io/portfolio/), `PREVIEW=1` everywhere else
(the sandbox `imevstratov-pixel/portfolio-v2`). Both run build, check-links and
leakcheck (with prodcheck) before the upload. Check both locally without
touching `dist/`:

```sh
BASE=/portfolio/ PREVIEW=0 npx astro build --outDir /tmp/prod
DIST=/tmp/prod BASE=/portfolio/ PREVIEW=0 npm run check-links
BASE=/portfolio/ PREVIEW=0 npm run leakcheck -- /tmp/prod
```

robots.txt is served at `<site><base>robots.txt`, but crawlers read only the
host root (`https://imevstratov-pixel.github.io/robots.txt`, another
repository). What keeps the sandbox out of search is the robots meta of every
page; the sitemap of the live site is submitted by hand in Yandex Webmaster
and Google Search Console, after each has verified ownership. The route
(README, «Moving the live site to this code», step 7): Google, a URL-prefix
property for `<site>/portfolio/` verified by `google<token>.html` dropped
into `public/` as is; Yandex, which adds sites by host, by `yandex_<token>.html`
in the host-root repository `imevstratov-pixel.github.io`. Verification files
(`google*.html`, `yandex_*.html`) are not pages: `legacy-preview` leaves them
untouched in preview, `prodcheck` does not ask them for a robots meta, and
the sitemap leaves them out (no page links to them). There is no
verification meta tag in `BaseLayout`.

Old home anchors (`src/layouts/LegacyAnchors.astro`, an inline script at the
top of the home page `<head>`): `#hire` goes to /hire/, `#cases` to /cases/,
`#c1`…`#c7` to /cases/staff-c1/…/cases/staff-c7/ (`location.replace`, the
query string kept), `#cta` to `#contact`, `#testimonials` and `#timeline` to
the sections «Что говорят коллеги» and «Обо мне» (by the block's anchor if the
content gives one, else by its heading), `#numbers` to the top. The map is
built from the content; prodcheck checks every target.

## 3. Helpers (`src/lib`)

### `url.ts`

```ts
import { url, absoluteUrl, anchor, isExternal, BASE } from '../lib/url';
url('/services/#audit')   // '<base>/services/#audit'
url('assets/og.jpg')      // '<base>/assets/og.jpg'
url('/demo/wishlist/')    // '<base>/demo/wishlist/'
url('#contact')           // '#contact' (same page)
url('https://t.me/x')     // unchanged; also mailto:, tel:, data:
absoluteUrl('/services/', Astro.site) // full URL for canonical / OG
anchor('contact')         // '#contact'
```

### `content.ts`

```ts
import {
  site, getPage, pageBlocks, getBlock, findBlock, gref, workloadLine, visible, isHidden,
  services, getService, serviceByCodeword, serviceHref, serviceDurationLine,
  servicePrice, servicePriceLine, globalPriceLine, splitLeadingPrice,
  cases, getCase, isPublished, publishedCases, caseHref, casePath, caseCardHref, caseNeighbours,
  caseWords, caseSummary, caseSeo, caseService, caseLabels, CASE_LABEL_FIELDS, contentHref,
  products, getProduct, isProductVisible, visibleProducts, productHref, productTemplate,
  getTestimonial, testimonialSignature,
  telegramButton, telegramUrl, singleHint, mailtoHref,
  bodyHtml, bodySections, linkSegments, type TextLink,
} from '../lib/content';
```

- `site`: data of `site/global.md` (section 5.2).
- `getPage(id)`: data of `pages/<id>.md`; ids `home`, `services`, `cases`,
  `products`, `free`, `hire`, `guide`, `404`. `pageBlocks(page)` returns the visible
  blocks in order; `getBlock(page, 'hero')` one block by id (throws if
  missing), `findBlock` the same but returns `undefined`.
- `gref('global.email.line')` resolves a global reference (used in contact
  blocks: `hint`, `email`, `lines`, `workload`, terms `source`); other values
  pass through. `workloadLine(ref)` returns the workload text or `null`.
- `visible(list)` drops items with `status: 'hidden'` (the export already did;
  use it anyway for FAQ items, rows, notes, as the renderer does).
- Services: `services` (all, by `order`), `getService('audit')`,
  `serviceByCodeword('Аудит')`, `serviceHref(slugOrEntry)` gives
  `<base>/services/#<anchor>`. `serviceDurationLine(s)` gives «Срок: около
  недели.».
- Prices: `servicePrice(s)` is the service's own price `{ main, note?, more[] }`
  or `null` (then the global line shows); `servicePriceLine(s)` the same as one
  line of text («Цена: 15 000 ₽.» or «Точную цену называю письменно до старта.
  Первый созвон бесплатный.», as price_line() in the renderer);
  `globalPriceLine()` the global line; `splitLeadingPrice(text)` splits «12 000
  ₽ за весь тренажёр, …» into `{ main: '12 000 ₽', rest }` (or `null`).
  Components show prices with `PriceBlock` / `ServiceTerms`.
- Cases: `cases` (published, by `order`, the order of /cases/ and of
  previous/next), `getCase(slug)`, `isPublished(slug)`, `publishedCases(slugs)`
  keeps only published ones, `casePath(c)` `/cases/<slug>/`, `caseHref(c)`
  `<base>/cases/<slug>/` (the case page: use it for every link to a case),
  `caseCardHref(c)` `<base>/cases/#<anchor>` (the card on /cases/: «Все кейсы»
  on a case page), `caseNeighbours(c)` `{ prev, next }` by order (null at the
  ends), `caseService(c)` the service entry of a case (cases store a
  codeword), `caseLabels(c, fields)` the non-empty label values.
  `caseSummary(c)`: the one line of a /cases/ card, the case's `summary`,
  else its line in the home featured-cases block, else the first sentence of
  «Контекст» (cut, not rewritten).
  `caseSeo(c)`: `{ title, description }` of the case page, the case's `seo`
  fields or «<shortTitle> — Даниил Евстратов» (short for search results and
  Telegram previews; the full title stays the h1) and the first sentences of
  «Контекст» and «Результат» (only the first one when together over 220
  characters).
  `caseWords()`: «Читать кейс», «Все кейсы», «Предыдущий кейс», «Следующий
  кейс», «Что говорят коллеги», `nav` «Другие кейсы» (the name of the case
  page's bottom navigation); the cases-list block of pages/cases.md overrides
  them with `cardLink`, `allLink`, `prevLabel`, `nextLabel`, `voicesLabel`,
  `navLabel` once the content has them.
- Content links: `contentHref(href)` is `url(href)`, except that a link to a
  case card written in the content (`/cases/#case-…`, e.g. the links of
  staff-c1) goes to the case page. Components that render link fields of the
  content (case links, proof links, hire facts and lines, product links,
  contact and group notes) use it.
- Products: `products` (visible, by `order`), `getProduct`,
  `visibleProducts(slugs)`, `productHref`, `productTemplate(p)` the message
  of the quiet link (global product template with the title, or the
  product's own).
- Testimonials: `getTestimonial(slug)`, `testimonialSignature(t, extra)` builds
  «Лиза, методист, Eduson Academy» and appends extra parts (hire: company,
  relation) when new and non-empty.
- Telegram and mail: `telegramButton(codeword)` returns
  `{ codeword, caption, template, service? }`; `telegramUrl`;
  `singleHint(codeword)`; `mailtoHref({ codeword, template })` or
  `mailtoHref({ subject })` or `mailtoHref()` (default subject «Сообщение с
  сайта»).
- Markdown bodies: entries carry rendered HTML. `bodyHtml(entry)` returns it;
  `bodySections(entry, only?)` splits it at `## ` headings into
  `[{ title, html }]` without the `h2` tags (so 18 cases on one page do not
  repeat ids). Example:
  `bodySections(c, ['Контекст', 'Что сделал', 'Результат'])` for /hire/.

The module validates cross-references when it loads: unknown case, service,
product or testimonial slugs, unknown Telegram codewords and duplicate anchors
fail the build with a list of problems.
- `linkSegments(text, links, { servicesPage?, where? })`: a line whose link
  labels become links inside the sentence (`links[{ label, service | case |
  href }]`, in order; a service goes to its card on /services/, or `#anchor`
  with `servicesPage`; a case to its page while published, else plain words;
  `href` through `contentHref`). Throws when a label is not in the text.
  Render it with `LinkedText`.

### `media.ts`

`imageSize('assets/portrait.jpg')` returns `{ width, height }` read from the
file in `public/` (JPEG, PNG, GIF, WebP); `publicFileExists(path)`. `Media`
uses them for `width`/`height` and the default ratio. For files to download
(/free/): `fileSize(path)` in bytes, `formatSize(bytes)` («244 КБ», «1,2
МБ», a non-breaking space before the unit), `pdfPageCount(path)` (from the
PDF's page tree, `null` when it sits in a compressed object stream).

### `types.ts`

`HeaderData`, `NavLink`, `NumberItem` (`{ value, label, source? }`), `FaqItem`
(`{ q, a }`).

### `env.ts`

`PREVIEW` (boolean), `METRIKA_ID`. Only `BaseLayout` needs them.

## 4. Layout and components (`src/layouts`, `src/components`)

All components are `.astro` files. Paths in examples are from a page in
`src/pages/<route>/index.astro` (use `../../`) or `src/pages/index.astro` (`../`).

### BaseLayout

```astro
<BaseLayout page={page} current="/services/">…</BaseLayout>
```

Props: `page` (from `getPage`; gives title, description, OG image and an
optional `header` override), `title`, `description`, `ogImage`, `noindex`
(overrides), `header` (full override), `current` (site path for
`aria-current` in header and footer), `ctaHref` (target of «Написать»;
default `page.header.ctaTarget` or `#contact`). Renders `<html lang="ru">`,
head (title, description, canonical, OG with absolute image URL and size,
robots in preview and for `seo.noindex`, fonts, Metrika in production; on
the home page first of all the old-anchor script `LegacyAnchors`),
`Header`, `<main id="main">`, `Footer`, the client script.
Font preloads: Inter Tight 400 and 700, Cyrillic and Latin, on every page
(the Latin subset holds the space, digits and punctuation, so Russian text
needs it too; without it the hero lead re-wrapped when it came, a layout
shift of 0.008 at 390 px), plus IBM Plex Mono 400 Latin on the home page
(the glyphs of the h1 and the big numbers). Layout shift of the home page
on load: 0 at 360 to 1440.
/hire/ passes its page and gets its own header automatically (`pages/hire.md
header`). The 404 page passes `ctaHref="/#contact"`. If `seo.ogImage` does not
exist in `public/` (guide's `assets/og-guide.jpg` today), the site image is
used.

### Header, Footer

Used by `BaseLayout`; pages do not include them. Header: name (home link),
page links, «Написать» (primary small button). Sticky first row; on phones the
links form a second row that scrolls away. Footer: Telegram and email as text,
all footer links (incl. «Работодателям» with goal `hire`, «English» to `/en/`),
«Сделано вместе с Claude», «© {year} Даниил Евстратов».

### Section

```astro
<Section id="faq" heading={faq.heading}>…</Section>
<Section rule="none" pad="s4"><h1>…</h1></Section>
<Section id="numbers" label="Цифры" heading={b.heading} level={2} size="large" wrap={false}>…</Section>
```

Props: `id` (anchor; adds `aria-labelledby` to `<id>-heading`),
`labelledby` (id of a heading inside the slot that names the section, when
`heading` is not passed; e.g. the `Steps` heading on the home page), `label`
(small mono line above), `heading`, `level` (2 or 3), `size` (`huge`, `large`,
`medium`), `rule` (`line` ink 1px on top, default; `hair` grey; `none`), `pad`
(space above: `s3`, `s4`, `s5` default), `wrap` (content inside `.wrap`,
default true), `class`. Slots: default, `head` (extra content under the
heading). Spacing: `pad` above the rule, `--s2` under it, `--s4` under the
heading.

### Prose

```astro
<Prose html={bodyHtml(product)} />
{bodySections(c).map((s) => (<><h3 class="label">{s.title}</h3><Prose html={s.html} /></>))}
<Prose size="medium"><p>{text}</p></Prose>
```

Props: `html` (rendered HTML) or slot, `measure` (max 66ch, default true),
`size` (`base` or `medium`), `class`. Styles for lists, blockquotes
(`white-space: pre-wrap` keeps quoted texts exact) and headings inside live in
`global.css` (`.prose`).

### Button

```astro
<Button href={hero.button.href} variant="primary" goal="telegram">{hero.button.label}</Button>
<Button href="/cases/">{b.allLink.label}</Button>
<Button href={product.data.action.url} goal="product">{product.data.action.label}</Button>
```

Props: `href` (content path or external; no href renders a `<button>`),
`variant` (`primary` ink fill, `secondary` frame; default secondary), `size`
(`base`, `small`), `block` (full width), `newTab` (default: true for http(s)
links), `goal` (analytics goal), `type`, `class`, any other attribute.

### TelegramButton

```astro
<TelegramButton codeword="Аудит" />                       <!-- word + caption, copies the template -->
<TelegramButton codeword="Аудит" variant="primary" />
<TelegramButton codeword="Вакансия" label="Обсудить роль" caption="в Telegram" variant="primary" />
<TelegramButton codeword={p.data.codeword} template={productTemplate(p)}
  label={p.data.messageLink.label} variant="link" goal="product" />  <!-- quiet product link -->
```

Props: `codeword` (from `site.telegram.buttons`; for product codewords pass
`template`), `template` (override), `caption` (override, `false` hides),
`label` (main text, default the codeword), `variant` (`primary`, `secondary`
default, `link` for a text link), `size`, `block`, `goal` (default
`telegram`), `class`. Opens `https://t.me/evstratovdanil` in a new tab; with
JS it first copies the template and shows «Скопировал, вставьте в чат» for
`copiedMs`. The home hero button and the footer link only open the chat: use
`Button` with `href={site.contacts.telegram.url}` there.

### EmailLine

```astro
<EmailLine />                                   <!-- «Или напишите на почту: imevstratov@gmail.com» -->
<EmailLine codeword="Курс" template={telegramButton('Курс').template} />
<EmailLine line={hero.email} />                 <!-- just the address -->
```

Props: `line` (text or global reference; default `global.email.line`),
`codeword`, `template`, `subject`, `size` (`base`, `medium`, `small`),
`class`. The address inside the line becomes a `mailto:` link with the
codeword as subject and the template as body (goal `email`).

### TelegramAction

```astro
<TelegramAction codeword={service.data.codeword} />
<TelegramAction codeword="Гайд" variant="primary" />
```

One button, the single-button hint («Нажмите, и начало сообщения
скопируется… начните со слова «Курс».») and the email line. Props:
`codeword`, `template`, `label`, `caption`, `variant` (default `primary`),
`hint` (default true), `email` (line, global ref or `false`), `subject`,
`class`. The service cards on /services/ pass `hint={false} email={false}`
(the hint and the email stand once under «Не нашли своё?»); the /guide/ hero
passes the guide service's verb label («Заказать тренажёр») and no caption.

### ContactBlock

```astro
<ContactBlock block={getBlock(page, 'contact')} />   <!-- home, services, cases, guide, hire -->
<ContactBlock block={getBlock(page, 'custom')} />    <!-- products (type cta-line) -->
```

Takes the page block as is and renders it inside a `Section` with its
`anchor` (default `contact`). Variants by content:
- `buttons: [codewords]`: hint above, grid of Telegram buttons (2 columns on
  phones, 4 from 720px), email line (medium size), workload, lines;
- `button: { codeword, hint }` (guide): one primary button, its hint, email
  line, lines; a codeword that belongs to a service shows the service's verb
  `button` label without a caption (decision 8 of 14.10), unless the block
  gives its own `label`;
- `button: { codeword, label, caption }` + `email: { text, subject }` (hire):
  primary Telegram button and the email as a second button
  (`TelegramEmailButtons`), `telegramText`, `resumes` (`Resumes`);
- `links` (products): a comma list of links under the text.
Props: `block`, `size` (`large` default, `huge`), `rule`, `class`.
On the home page the block shows the workload line; the texts renderer
describes the other pages' blocks as «как на главной», and the content of
those blocks already carries the same fields.

### TelegramEmailButtons, Resumes

```astro
<TelegramEmailButtons button={b.button} email={b.email} />   <!-- /hire/ first screen -->
<Resumes items={b.resumes} />
```

`TelegramEmailButtons`: the primary Telegram button (codeword, `label`,
`caption`) and, when `email.text` is given, the email as a second framed
button (subject and template from the codeword). No hint. `Resumes`: the PDF
links as sans text links with the meta in small grey mono. ContactBlock uses
both, so the /hire/ first screen and its contact block look the same.

### Steps

```astro
<Section id="how-we-start" labelledby="how-we-start-heading"><Steps headingId="how-we-start-heading"
  showConsultationNote={b.showConsultationNote} showPrepare={b.showPrepare} showWorkload={b.showWorkload} /></Section>
<Steps heading={false} level={3} showConsultationNote={false} showPrepare showWorkload={false} />
```

«Что будет после вашего сообщения» from `site.work.howWeStart`: heading, four
steps (large mono numbers from a CSS counter, «**Вы пишете.** text»), then the
optional lines. Props: `heading` (bool), `level` (2 or 3), `headingId` (id
of the heading, for `Section labelledby`), the three `show…` flags (take them
from the block: home `steps`, services `formats.howWeStart`), `class`.

### Numbers

```astro
<Numbers items={hero.numbers} note={hero.numbersNote} />
<Numbers items={b.items} note={b.note} columns={3} />   <!-- /hire/, 6 items -->
```

Value in large mono, label, small source, note line. 2 per row on phones;
`columns={4}`: 2 from 720px, 4 from 1080px; `columns={3}`: 3 from 720px.

### Quote

```astro
<Quote text={q.text} cite={q.attribution} size="medium" />
```

Props: `text`, `cite`, `size` (`large` default, `medium`, `base`), `marks`
(«» added by CSS, default true), `class`. Keeps the text's spacing exactly.

### VideoTestimonial

```astro
<VideoTestimonial testimonial={t} layout="card" size="medium" />               <!-- a Carousel slide -->
<VideoTestimonial testimonial={it.t} extra={[it.company, it.relation]} layout="card" size="medium" />
<VideoTestimonial testimonial="evgenia" size="medium" />                         <!-- a full-width row -->
```

Poster in the native player (9:16) and the quote beside it with the
signature. `layout="card"` (home, /hire/, the case pages, always inside a
`Carousel`): a hairline on top, the video on 2 parts and the quote on 3 parts
of the card at every width, the quote at the base size on phones and in the
`size` from 720px. `layout="row"` (default, kept for client quotes): video 3
of 12 columns, quote 6 of 12; on phones a 7.5rem video column. Props:
`testimonial` (slug or entry), `extra`, `quote` (default true), `size`
(`large` default, `medium` for colleagues), `layout`, `class`.

### Carousel

```astro
<Carousel items={colleagues} label={heading} id="home-colleagues" bleed>
  {(t: (typeof colleagues)[number]) => <VideoTestimonial testimonial={t} layout="card" size="medium" />}
</Carousel>
<Carousel items={shots} kind="media" ratios={shots.map(ratio)} label={d.title} id={`${id}-gallery`} bleed>
  {(g: Shot, i: number) => <figure>…</figure>}
</Carousel>
```

A horizontal row of slides (decision 11 of 14.10): «Что говорят коллеги» on
the home page, /hire/ and the case pages, and the product galleries. Pass the
items and a function child that renders one slide (`Astro.slots.render` with
the item and its index). Markup: the track (the scrolling region) holds a
rail (`.carousel__rail`) that holds the slides. Static HTML first: the track
scrolls with scroll snap (swipe on phones) and always shows part of the next
slide; under it «1 из 5» / «1–2 из 5» (the slides fully in view, a polite
live region, so the new position is announced once the row comes to rest)
and the buttons «Назад» and «Дальше» (they pause the row's videos, no
autoplay). With motion allowed (decision 2 of 15.10) the script loads Embla
Carousel (with the wheel-gestures plugin) when the row comes within half a
screen: `data-embla` on the root, the track clips and the rail moves (the
root is a single `minmax(0, 1fr)` column, so a clipping track never widens
the page past its edge, e.g. a bleed media row on a phone): drag
with the mouse, swipe, trackpad, momentum and snap (`cards`: one slide per
swipe; `media`: a flick may pass several), the buttons and the arrow keys
glide to the next slide, Tab into a slide brings it into view, a drag never
starts on a video that has been played. With `prefers-reduced-motion` Embla
is not loaded: the native row stays and the buttons move by one slide at
once (no smooth scrolling); the mode follows the setting when it changes,
and the row stays on the slide it showed (Embla starts from the native
scroll position; going back, the native track scrolls to Embla's slide).
The row keeps its height in both modes: where scrollbars are classic (not
overlay) the native track shows one under the slides, so the script
measures it before Embla clips the track and keeps that room
(`--carousel-sb`); nothing below the row moves when Embla takes over.
The row is a focusable region named by `label` (`aria-roledescription`
«карусель», the arrow keys move by one slide), each slide a group «2 из 5»;
every slide stays in the DOM. The bar shows only after the script ran
(`data-ready`): without JS the row still scrolls and no counter can be
wrong; when every slide fits the script sets `data-static` and the bar goes;
one slide renders no bar. With `bleed` the last slide stops at the gutter in
both modes.
Props: `items`, `label`, `id` (unique prefix), `kind` (`cards` default:
85% of the row on phones, 60% on tablets, 5 of 12 columns from 1080px;
`media`: one row height, 25rem phones, 26rem tablets, `height` or 30rem from
1080px, each slide as wide as its ratio allows, at most 85% (75% from
1080px)), `ratios` (width / height per item, `media` only), `height`,
`bleed` (the row runs into the side gutters, to the screen edges on phones),
`class`. Script: `src/scripts/carousel.ts`, bundled only on pages that use it.

### AgentsScheme (`components/scheme/`)

```astro
<AgentsScheme idPrefix={`${id}-scheme`} level={2} facts={false} />                 <!-- case page -->
<AgentsScheme level={5} titleSize="base" idPrefix={`${anchor}-scheme`} />         <!-- /hire/ -->
<AgentsScheme heading={false} facts={false} idPrefix={`${d.anchor}-scheme`} />    <!-- /services/ «Подробнее» -->
```

The multi-agent scheme from the old site (decision 12 of 14.10), redrawn as
an inline SVG in ink, paper and muted: input and the methodologist, the
distributor, the three groups of agents, the two human checks, the output
and the shared base. Its labels, heading («Как устроены AI-агенты»), facts
and hint live in the component (content field `scheme: "ai-agents"` only
switches it on); the texts renderer keeps a copy in `SCHEMES`, so change
both together. Every SVG label is at least 11 viewBox units and the drawing
is never scaled down (min-width 1180px, the viewBox width), so no label
renders under 11px. By the component's own width (container queries): from
1180px the drawing at the full width; 720–1179px the drawing at 1:1 scrolls
sideways with «Схему можно прокрутить вбок» above it; below 720px (phones,
tablets in portrait) the same labels as a vertical list (stages Вход,
Распределение, AI-агенты with the three groups and the two human checks,
Выход, the shared base; 1px frames, rules with small arrowheads). The facts
under it: a wrapping line with hairlines, a two-column list below 720px;
the case page passes `facts={false}` (the case infographic carries the numbers).
Give it the full container width (1184px at a 1280px window): on the case page
under the case, on /hire/ as its own full-width row under the staff case, on
/services/ inside the AI-agents «Подробнее».
Props: `heading` (text or `false`), `level` (default 3), `titleSize`
(`medium` default, `base`), `facts` (list or `false`), `hint`, `idPrefix`
(unique per page), `class`.

### Media

```astro
<Media src="assets/portrait.jpg" alt={about.portraitAlt} ratio="1 / 1" loading="eager" />
<Media type="video" src={reel.video} poster={reel.poster} ratio="9 / 16" label={reel.hook} />
<Media src={p.data.media.src} alt={p.data.media.alt} maxWidth="20rem" />
```

Props: `src` (content path; empty renders nothing), `type` (`image` or
`video`, guessed from the extension), `alt`, `poster`, `label` (accessible
name of a video), `ratio` (CSS ratio; default the file's own), `fit`
(`cover` default, `contain`), `loading` (`lazy` default, `eager` above the
fold), `maxWidth`, `class`. Ratios: reels and testimonials `9 / 16`; product
screenshots are phone screens (554×1220 and 536×1170), use their own ratio.

### CaseLabels, CaseCard

```astro
<CaseLabels case={c} />                                  <!-- «В штате, EdTech, …, 2025–2026, Обучение, **в работе**» -->
<CaseCard case={it.case} line={it.line} linkLabel={b.cardLink} title="title" />
<CaseCard case="staff-c2" linkLabel="Читать кейс" service labels={false} />
```

CaseLabels props: `case`, `fields` (default origin, industry, year, duration,
direction), `status` (default true), `class`. The labels show in grey mono
capitals (CSS `text-transform`), the status in bold black. A number stays on
the line of the word after it («23 дня»: a non-breaking space, typography only). CaseCard props: `case`, `line`,
`linkLabel` (no link when omitted; the link goes to the case page
`/cases/<slug>/`),
`title` (`shortTitle` default or `title`; the home featured cards use
`title`), `labels` (fields or `false`; default origin, industry, year,
direction, as on the home page), `service` (show the service short name),
`level`, `class`. Cards have a hairline on top; put them in `.cols.cols-2`.

### ServiceRow

```astro
<ul class="list-rules" role="list">
  {b.main.map((it) => <ServiceRow service={it.service} line={it.line} linkLabel={b.linkLabel} duration={b.showDuration} price action />)}
</ul>
<ul class="list-rules" role="list">
  {b.more.map((it) => <ServiceRow service={it.service} line={it.line} linkLabel={b.linkLabel} href={it.href} duration={b.showDuration} price action size="small" />)}
</ul>
```

An `<li>` with the compact logic of the service cards: title (full `title`,
bold), the line, then «Срок» and «Цена» on the rail of the /services/ cards
(`ServiceTerms`; `duration`, `price`): the duration as written, then the
price, never louder than the title. Main rows (`size="large"`, title medium
bold): the figure at the medium size, regular, and the `note` under it, so
«15 000 ₽» reads as a session, not as the price of the framework the line
also names (`show="note"`). Small rows (`size="small"`, title base bold): the
figure only, at the body size (`show="main" size="base"`). The sub-prices
stay on /services/, as the texts renderer asks (`price_line`). Then
the verb link (`action`: the service's `button`, a Telegram link that copies
the start of the message, in bold) and «Подробнее»
(`linkLabel`; `href` override from the content, default `/services/#anchor`).
From 720px title on 5 columns and the rest on 7. Props: `service`, `line`,
`linkLabel`, `href`, `duration`, `price`, `action`, `size` (`large`,
`small`), `title` (`title` or `short`), `level`.

### Services on /services/ (`components/services/`)

`ServiceCard` renders every service as a compact card (decisions 8 and 10 of
14.10, `render_card()` and `render_service()` in the texts renderer): number,
title and the italic one-line `summary` (the full 6 columns) in columns 1–6;
the three `highlights` (dash list), «Срок» and «Цена» (`ServiceTerms`: the
duration, then the `PriceBlock` with the figure, the note and the sub-prices,
or the global line in bold), the verb button (`TelegramAction` with
`label={button}`, no caption, no hint, no email line, so the Telegram
template mechanism stays) in columns 7–12. The copy hint and the email line
stand once in `ServicesIntro`, under «Не нашли своё?» (`intro.other.hint`,
`intro.other.email`). Under the card «Подробнее» (`Disclosure`, sticky, with
the service's `short` name as context; «Свернуть» is
`serviceTemplate.labels.less` or the default) opens the full template on the
spot: body, `AgentsScheme` without heading and
facts for `scheme: "ai-agents"` (full width), «Для кого», «Что получите на
руки», «Сколько длится», «Как идёт работа», «Что нужно от вас», «Что не
входит», «Нейросеть и расходы», proof, «Мои продукты», «Что говорят
коллеги» (text quotes). The parts are `ServicePart` rows: label in columns
1–3, text in 4–12 (4–10 from 1080px). `short` (group variant `short`, the
guide): the same card with the `more` link («Подробнее о тренажёре», /guide/)
beside the verb button; its «Подробнее» opens only «Для кого» and «Что
получите на руки» (as the renderer). Phones: one column.
`ServiceGroup` renders a group (heading, lead, note with links through
`LinkedText servicesPage`, its cards),
`ServicesIntro` the h1, lead and table of contents, `Formats` #formats (see
5.1: the steps, the two payment formats, «Почему со мной предсказуемо» with
the work screenshots, the terms). Screenshots (`proofImages`): from 720px on
the 3-column grid of the «Почему со мной предсказуемо» items, each figure
starting on its column line; one height for all (the widest-ratio image
fills its column, the others are as wide as that height allows); on phones
one under the other, at most 24rem high; the caption under each in small
mono. Each is a plain link to the full image (new tab); with JS a click
zooms the image out of the page instead (`Lightbox`).

### LinkedText, LeadMagnet

```astro
<p><LinkedText text={d.text} links={d.links} where="pages/free" /></p>
<LinkedText text={note.text} links={note.links} servicesPage />   <!-- /services/ group note -->
<LeadMagnet block={b} />                                         <!-- type "lead-magnet": home, /services/ -->
```

`LinkedText` renders `linkSegments` inline (props `text`, `links`,
`servicesPage`, `where`, `goal`): the services group note, the line about the
consultation and the audit on /free/, the free-guide line on a case page.
`LeadMagnet` is the free-guide block (`free-guide`, decision 18) on the home
page (before #contact) and on /services/ (between the groups «Обучение и
AI-производство» and «Разработка на заказ»): a section with an ink line, a
small cover (`image`, a hairline frame, a link to the same place for the
mouse only, `tabindex="-1" aria-hidden="true"`) in column 1 of 4 on phones
and 1–2 of 12 from 720px, beside it the heading (h2, medium), the line and the
framed small link (`link { label, href }`, to /free/). Without `image` the
text takes the row.

### Parsed (`components/Parsed.astro`, `lib/parse.ts`, decision 1 of 15.10)

```astro
<Parsed text={f.legend} inline where="site/global.md footer.legend" />                          <!-- the footer legend -->
<Parsed text={b.headlineParse} plain={b.headline} where="pages/home.md hero.headlineParse" />   <!-- a parsed line with its plain text -->
```

A content line with inline tokens `[слова|член предложения]` (подлежащее,
сказуемое, дополнение, определение, обстоятельство), rendered with the
member's underline (`.u-subj` … `.u-circ`). The words inside a token never
break apart, and between the tokens a one- or two-letter Cyrillic word stays
with the word after it («и» on the line of «не скамит», «в» with «жизни»;
non-breaking spaces, typography only; the build check and the screen-reader
copy use the text before them). `plain`: the approved
text; the parse must read exactly as it without the tokens, or the build
fails (`parseSentence`). Default: a visually hidden plain copy for screen
readers (not selectable) and the underlined copy `aria-hidden`, so the line
is read in one piece; `inline`: the spans stay in the text (the legend,
whose underlined words are its own words). An unknown member or a broken
token fails the build. The home h1 was parsed this way until it went to
glyphs (decision 6 of 15.10): it is not underlined now, and `headlineParse`
is not drawn. Footer: `site.footer.legend`, one small grey line under a
hairline, the samples in ink.

### AsciiHeadline, DitherPortrait (`components/glyphs/`, decision 6 of 15.10)

```astro
<AsciiHeadline text={headline} as="h1" id="hero-heading" size="var(--fs-huge)" width="10.5em" shimmer={false} />   <!-- home hero -->
<DitherPortrait src={photo.src} alt={photo.alt} />                                                                  <!-- home «Обо мне» -->
```

Prototypes B and C of /lab/, now on the home page with the lab's default
settings: the phrase drawn in glyphs over its real text (the h1 stays the
text for search engines and screen readers and sets the box), and the photo
in one bit in a box of the photo's ratio (the `<img>` stays the fallback and
the box carries the alt). A lens under the pointer or a finger, nothing
moves by itself, static with reduced motion, the plain text or photo under
forced colours and without JS, no layout shift, no frames off screen or in
a background tab, the canvas built in short tasks. Props, behaviour, costs
and the switch to the drawn portrait: docs/lab.md.

### Free materials on /free/ (`components/free/`, decision 18)

`FreeItem` is one item of the `free-items` block: an ink line, the cover
(phones: half the width, above the text; from 720px columns 1–4, text 6–12;
from 1080px 1–3 and 5–11), the kind as a mono label, the title (h2, large),
`text` (medium size, who it is for), `insideLabel` (small mono, h3) and
`inside` as `.list-dash`, the `format` line in small mono, then the primary
button `downloadLabel` with the file size as its second line (`.btn__caption`,
`formatSize(fileSize(file))`): a plain link to the file with `download`,
`type="application/pdf"` and goal `download`; the cover is the same link for
the mouse only (`tabindex="-1" aria-hidden="true"`). Then `discuss`
(`LinkedText`: «консультация» and
«аудит курса» lead to their cards on /services/). The build fails when the
file is missing or when «PDF, N страниц» in `format` differs from the PDF's
page count. The items are a list (`ul.free-list`, `--s5` apart): a new
material is one more item in the content. The page ends with `ContactShort`
(block `contact`, type `contact-short`).

### PriceBlock, ServiceTerms

```astro
<PriceBlock service={s} />                                 <!-- figure, note, sub-prices; or the global line -->
<PriceBlock service={s} show="note" />                     <!-- the figure and what it covers -->
<PriceBlock service={s} show="main" size="base" />         <!-- the figure only, body size -->
<PriceBlock text={hero.price} size="large" />              <!-- /guide/ hero: «12 000 ₽ за весь тренажёр, …» -->
<ServiceTerms service={s} />                               <!-- /services/ card: «Срок» and «Цена» -->
<ServiceTerms service={s} show="note" />                   <!-- home main rows, case page offer -->
<ServiceTerms service={s} show="main" size="base" />       <!-- home rows «Ещё делаю на заказ» -->
```

`PriceBlock` (decision 16 of 14.10): `main` in the sans face, regular
weight, at `--fs-medium` (default `size="medium"`, the size of a service
title: the weight tells them apart), `--fs-base` (`size="base"`) or
`--fs-large` (`size="large"`, only the /guide/ hero), `note` under it in the body size,
`more` as a small dash list (0.9375rem). Typography only: a dash stays on the
line of the word before it and «от», «до», «около» stay with the figure
(non-breaking spaces), the words are as approved. Props: `service` (its
price), `price` (an object), `text` (a line that starts with a figure: the
figure on its own line, the rest of the sentence under it, one
paragraph; a line without a figure renders as is), `show` (`full`, `note`:
figure and note, `main`: the figure only), `size` (`medium`, `base`,
`large`), `fallback` (show `site.work.price` in bold when
there is no price; default true), `class`.
`ServiceTerms`: a `<dl>` of two rows on one rail, the small mono name
(«Срок», «Цена», the renderer's labels) in 4.5rem on the left, the value
beside it on the baseline of its first line; a hairline above each row. Props:
`service`, `duration`, `price` (rows on/off), `show`, `size` (passed to
`PriceBlock`), `class`. /guide/ uses `PriceBlock text size="large"` in the
hero (under a hairline, under the button and the email line) and `PriceBlock
text` at the medium size for a note of a numbered block that starts with a
figure («Что входит»).

### Disclosure (`components/Disclosure.astro`, `.disclose` in global.css)

```astro
<Disclosure more={labels.more} less="Свернуть" context={d.short} class="svc__more">…</Disclosure>
```

A native `<details class="disclose">` (decision 17 of 14.10). The summary
holds a small framed button «Подробнее +»; while open it reads «Свернуть −»
(both texts are in the markup, CSS shows one, so it works without JS; hover
inverts the button). `sticky` (default): while open, the summary sticks under
the site header (`top: header-h + 1px`) as a full-width bar on paper with a
hairline under it and shows `context` beside the button in small grey mono
capitals, so the text can be closed from its middle. While the bar is
stuck, everything inside the details has `scroll-margin-top` of the bar's
height (`--disclose-bar`), so focus moved with Tab or Shift+Tab stops under
the bar, not behind it (WCAG 2.4.11). At the end of the content a second
«Свернуть −» (`.disclose__close`, the same framed `.disclose__btn` as the
summary, not a filled button: that is the Telegram CTA's look) closes it,
moves the focus to the summary and jumps at once (`scrollBy`, behavior
`instant`) to the top of the closest `[data-disclose-root]` (the service
card) under the header, but never so far that the summary leaves the screen:
on a phone, where a card is taller than the screen, the summary lands at the
bottom edge with the price and the button above it. Closing from the stuck
summary makes the same jump only when the summary's own place is above the
header after closing; closing it where it opened moves nothing. The end button shows only
once `src/scripts/disclose.ts` ran (`data-ready` on the details), so without
JS there is no dead button. Props: `more`, `less`, `context`, `sticky`,
`class` (style it from the parent with `:global()`). Used by `ServiceCard`.
Motion (decision 2 of 15.10, `src/scripts/accordion.ts`): with motion
allowed the details opens and closes on a critically damped spring (Motion,
height of the details, the content fading in); only the part on screen
animates (a long text grows to the bottom of the screen, the rest is added
below the fold in one step); a click during the animation turns it around.
While it closes, the summary already shows «Подробнее +» (`data-closing`,
`motion.css`). The end button and the stuck summary jump first, with the text
still open, then fold it up on the spring under the summary; closing in
place folds without a jump. With `prefers-reduced-motion` and without JS
everything is instant, as described above.

### Lightbox (`components/motion/Lightbox.astro`, decision 2 of 15.10)

```astro
---
import Lightbox from '../motion/Lightbox.astro';
---
<Lightbox />   <!-- once per page, anywhere: it renders nothing -->
<a href={url(src)} target="_blank" rel="noopener" data-lightbox><Media src={src} alt={alt} /></a>
```

Static HTML first: a thumbnail is a plain link to the full file with
`data-lightbox` (new tab, `cursor: zoom-in`). The component adds
`Lightbox.css` and `src/scripts/lightbox.ts` (under 1 KB): at the first
pointer over a thumbnail, touch on one or keyboard focus on one it loads
`src/scripts/lightbox-ui.ts` (about 6 KB, 2.5 KB gzip) and, with motion
allowed, Motion (`src/scripts/motion-lite.ts`, the chunk the accordions
share; never under reduced motion). A click then opens the image in place
(a click before the code has arrived waits for it; if it cannot load, the
file opens in a new tab); with a modifier key or the middle button the tab
opens as before. Nothing of the lightbox loads for a visitor who does not
touch a screenshot. (Until 15.10 it was a React island with Radix UI
Dialog: 356 KB, 116 KB gzip, and on /products/ it loaded with the page.)
The browser's modal `<dialog>` (`showModal`): the page behind is inert for
the mouse, the keyboard and screen readers (unlike `aria-hidden`, which
left the scripts and live regions of `main` exposed), it is modal for
assistive technology, Esc closes, focus starts on «Закрыть» and returns to
the thumbnail. Its name is the thumbnail's `alt`, its description the
caption (the figure's `figcaption`); the zoomed image has `alt=""`, so the
text is read once. While open the page does not scroll (`overflow: clip` on
`<html>`, `scrollbar-gutter: stable` where scrollbars are classic, so
nothing behind moves). Open: the image grows from its thumbnail (which steps
aside) to the largest size that fits the screen, never above its own
pixels, on a spring with a little bounce; the page fades to paper; the
caption and the bar fade in: «Открыть файл» (a framed `.btn` link to the
full file, new tab) and «Закрыть» (the small framed button, no lines).
Close: Esc, «Закрыть», a click or tap anywhere, or a swipe up or down on the
image (the paper thins as it goes): the image goes back into its thumbnail.
Phones: the image keeps the browser's pinch-zoom (`touch-action:
pinch-zoom`; a second finger ends a swipe at once and a multi-touch never
closes); zoomed in (`visualViewport.scale` above 1), one finger pans the
image (`data-zoomed`, `touch-action: auto`) and a tap does not close. With
`prefers-reduced-motion` it opens and closes at once and there is no swipe.
Used by `Formats` (/services/, the work screenshots) and the products page
(every image of the galleries and the single screenshots).

### Cases (`components/cases/`, decision 17 of 14.10)

/cases/ is a list of cards; every published case has its page
/cases/<slug>/ (`src/pages/cases/[slug].astro`, slug = file name).
`CaseListCard` (a card on /cases/): an ink line, `CaseLabels` with the status,
the title (h2, medium, a link to the case page: people tap titles first),
the infographic facts (`CaseInfographic parts={['facts']}`), the one line
`caseSummary(c)`, «Читать кейс» (small framed button to the case page,
`caseWords().cardLink`). The card carries the case
`anchor` as its id, so /cases/#case-… still lands on it. From 1080px the text
in columns 1-5 and the facts in 6-12 beside it; below that one column.
`CaseFull` (the case page): «Все кейсы» (to the card on /cases/,
`caseCardHref`), the labels, the title (h1 at the large size), the whole
infographic at the full width, the text rows (Контекст, Что сделал,
Результат; from 1080px the name in 1-3 and the text in 4-10, or 4-9 when the
vertical reel stands in 10-12 beside them; below 1080px the name above the
text, the reel in 10-12 from 720px and at half the width after the text on
phones), the `AgentsScheme` (staff-c2, full width, h2), the links (framed
small buttons, `contentHref`), the testimonials as a `Carousel` of cards,
then «Что из этого сделаю для вас» (an ink line, the name in 1-3, the text
in the medium size in 4-10 with the service title linked to /services/, the
service's «Срок» and «Цена» (`ServiceTerms show="note"`: the figure at the
medium size and what it covers), and the verb `TelegramAction`:
`label={button}`, no caption, its hint, no email line), then the bottom
navigation `<nav aria-label={caseWords().nav}>` («Другие кейсы»): the
previous and next case by order (`caseNeighbours`: a mono label and the short
title; two halves from 720px, next at the right edge) and «Все кейсы» on its
own row under them (`caseCardHref`, back to this case's card).
The route adds `ContactShort` and takes the title and description from
`caseSeo`. A case with `leadMagnet { text, link { label, href } }`
(healthtech-course-consulting, decision 18) gets one more text row without
a label after «Результат»: the line with its link words (`LinkedText`, to
/free/).
`ContactShort`: the short contact block of a case page and of /free/ (anchor
`contact`): the heading of the given contact block (/cases/, or `contact` of
pages/free.md) at the medium size, the plain
«Написать в Telegram» button (opens the chat), the email line, the workload
and the global price line in grey. Props: `block`, `lines` (default
`['global.work.price']`), `class`.
`CaseInfographic`: the facts as large mono values with their labels under an
ink line (only the number is large: a qualifier before it, «около», «почти»,
«в», and a unit after it, «дня», «млн ₽», are set small beside it; a value
without a digit is bold sans at the medium size; every value box has the
height of one large mono line, so the labels of a row line up), two per row;
three in a row from 560px of available width, four from 760px (so labels
like «уровня самостоятельности» never break inside a word); `flow` as
numbered steps joined by 1px rules (a row from 560px, a column with a
vertical rule below); `beforeAfter` as «Было» (grey) and «Стало» (bold, ink
line) side by side. Container queries, so it works on a card and at the full
width. «Шаги», «Было», «Стало» are the renderer's labels. Prop `parts`
(default facts, flow, beforeAfter). `CasesToc`: the groups (`TocGroups`: the
service's short name in small mono capitals, then the rows of `row.fields`,
today the short titles only, linking to the case pages, and the group's
products with their labels in small mono on the title's line). From 720px the
table is open, the groups flow in 2 columns (3 from 1080px); on phones it is
folded in a native `<details>` whose summary is the heading (h2) with «+» /
«−». The two renderings carry the same links, only one is displayed. The
legend line under each.

### Products on /products/ (`components/products/`)

`ProductItem`: kind, the name in huge type. A `gallery` of two or more
(decision 14 of 14.10) is a `Carousel` of `kind="media"` right under the name
(screenshots with a hairline frame and native videos with posters, the
caption under each), then the text in columns 1–7 and `ProductFacts` in
9–12. One picture (the gallery's only item, or `media` when there is no
gallery): the screenshot with its caption in the side column, the facts under
the body. The first gallery item is also `media` in the content; it is shown
once. Every screenshot is a plain link to the full file (new tab) that the
page's `Lightbox` (one, at the top of the list) opens in place; a drag
of a gallery is never a click. Only the first picture of the first product loads eagerly
(`first`), the rest lazily. Status labels, the action button, secondary links
and the quiet Telegram link are as before.

### Home «Обо мне» and /hire/ «Опыт»

`home/About`: the picture is a `DitherPortrait` (decision 6 of 15.10):
`photo { src, alt }` (decision 9 of 14.10, Daniil's selfie) in one bit in
its 4:5 box, 4 of 12 columns (half the width on phones); while the photo is
hidden in the content, the drawn `portrait` (1:1). `ONE_BIT = 'portrait'` in
the component switches to the drawn portrait cropped to the face, as /lab/
shows it (the selfie reads poorly in one bit: the face is behind the phone
and its flash). `hire/Experience`: the staff cases (`show: full`) are rows
of the place's grid in columns 4–12; a case with `scheme: true` gets the
`AgentsScheme` (heading at the base size, h5) under it across all 12 columns.
`hire/StaffCase` no longer draws a scheme. `hire/HireTestimonials` and
`home/Testimonials` render the colleagues as a `Carousel` of cards.

### FAQ

```astro
<Section id={faq.anchor} heading={faq.heading}><FAQ items={faq.items} /></Section>
```

`<details>/<summary>` per item, «+»/«−» marker, hairlines. Under the
pointer (`hover: hover` only) the question gets the wave of a link
(определение, accents), on the question's own span (`.faq__q-text`): the
summary is a flex row whose marker is an in-flow item, so a line on the
summary would run under «+»/«−» too. With motion allowed an answer opens and closes on a
spring (`scripts/accordion.ts`) and the wave comes in like a link's
(`u-wave-in`) and fades out over `--dur-hover`; without JS or with reduced
motion it toggles at once and the wave appears at once. Props: `items` (`{ q, a }`, hidden and empty ones are skipped), `open`,
`class`.

## 5. Content structure

Collections are defined in `src/content.config.ts` (glob loader, ids = file
names). Typed fields below; unknown extra fields are kept.

### 5.1 pages (`getPage(id)`)

Every page: `seo { title, description, ogImage?, noindex? }`, `blocks[]`
(`{ id, type, anchor?, … }`), optional `header`. Blocks per page:

**home**
- `hero` (hero): `name`, `role`, `headline` (the h1, drawn in glyphs: `AsciiHeadline`), `headlineParse?` (not drawn since decision 6 of 15.10; the export drops it), `lead`, `button { label, href }` (plain chat link), `email`, `availability`, `numbers[{ value, label, source }]`, `numbersNote`
- `clients` (names): `lines[{ label, names[], note? }]`, `link { label, case }` (to `caseHref`)
- `services` (services): `heading`, `lead`, `showDuration`, `main[{ service, line }]`, `moreHeading`, `more[{ service, line, href? }]`, `linkLabel` (each row also shows the price line and the service's verb `button`)
- `reels` (reels): `heading`, `hint`, `linkLabel`, `items[{ case, video, loop, poster, hook }]` (use `video` + `poster`; `.scroll-row`)
- `featured-cases` (cases): `heading`, `cardLink`, `items[{ case, line }]`, `fallback[]`, `returnLine { text, cases[] }` (show only when all its cases are published), `allLink { label, href }`
- `how-we-start` (steps): `source`, `showConsultationNote`, `showPrepare`, `showWorkload` (component `Steps`)
- `testimonials` (testimonials): `heading`, `headingColleaguesOnly`, `clients.items[]` (empty now, so the heading is `headingColleaguesOnly`), `colleagues { caption, hint, items[] }` (a `Carousel`)
- `free-guide` (lead-magnet, component `LeadMagnet`): `heading`, `text`, `link { label, href }` (/free/), `image? { src, alt }` (the guide cover)
- `about` (about): `heading`, `portrait`, `portraitAlt`, `photo? { src, alt }` (hidden until Daniil sends the photo; when visible it replaces `portrait` here), `text[]`, `experience[{ years, place, role, note }]`, `experienceLink { label, href }` (`/hire/#experience`), `productsLine { text, linkLabel, href }`
- `contact` (contact): `anchor`, `heading`, `hint`, `buttons[]`, `email`, `lines[]`, `workload`

**services**: `serviceTemplate { labels { forWhom, youGet, duration, steps, fromYou, notIncluded, ai, proof, proofLinks, proofCasesBuilt, proofProducts, testimonials, readCase, more, less? }, button { source, hint, email } }` (`less`, «Свернуть», is not in the content yet: `ServiceCard` falls back to «Свернуть»)
- `intro` (intro): `heading` (h1), `lead[]`, `toc.items[]` (service slugs, show `short`), `other { text, button }` (codeword «Другое»)
- `group-learning`, `group-development`, `group-personal` (service-group): `heading`, `lead?`, `note? { text, links[{ label, service | case }] }`, `services[]`, `variant?` (`short` → `ServiceCard short`)
- `free-guide` (lead-magnet, between `group-learning` and `group-development`): as on the home page
- `formats` (formats, anchor `formats`): `heading`, `howWeStart { showConsultationNote, showPrepare, showWorkload }`, `pricing { heading, items[{ title, points[] }] }`, `predictable { heading, items[{ title, text }] }`, `proofImages[{ src, alt, caption, status? }]` (the work screenshots under «Почему со мной предсказуемо»; hidden ones are dropped by the export), `terms { heading, items[{ id, text } | { id, source }] }` (`gref(source)`)
- `faq` (faq): `anchor`, `heading`, `items[{ q, a }]`
- `contact`

**cases**
- `intro`: `heading` (h1), `lead`
- `toc` (cases-toc): `heading`, `groups[{ service, products? }]` (rows: published cases whose `service` codeword matches; skip empty groups), `row.fields` (`shortTitle, industry, duration`), `productRow { labels[], hrefPattern }` (`/products/#{anchor}`), `legend { origin, direction }`
- `cases` (cases-list): `sort`, `sections[]` (the four h2 sections), `labels[]` (label fields), `statusField`, `serviceLinkLabel` («Что из этого сделаю для вас»: link to the case's service, `serviceHref(caseService(c))`); optional, not in the content yet: `cardLink`, `allLink`, `prevLabel`, `nextLabel`, `voicesLabel`, `navLabel` (`caseWords()`). The same block drives the case pages /cases/<slug>/ (sections, labels, status, service line)
- `contact` is also the source of the case pages' `ContactShort` (heading, workload, email)
- `contact` (the full block on /cases/)

**products**
- `intro`: `heading` (h1), `lead[]`
- `products`: `items[]` (product slugs, `visibleProducts`), `labels { inside, status, platform }`
- `custom` (cta-line, anchor `contact`): `heading`, `text`, `links[{ label, service, href }]`, `buttons[]`, `hint`, `email`, `lines[]`

**guide** (`header.ctaTarget: '#contact'`)
- `hero`: `heading` (h1), `lead`, `button { codeword, hint }`, `email`, `price` («12 000 ₽ за весь тренажёр, …»: `PriceBlock text`), `media` (pending)
- `recognize`: `heading`, `scenes[]`, `story { heading, case, text[] }`, `quote { text, attribution }`, `task { caption, source, instruction, prompt, notice, media }`, `demo { label, url, note, tryFirst }`
- `included`, `safety` (numbered): `heading`, `lead?`, `items[{ title, text }]`, `notes[{ text }]` (a note that starts with a figure in roubles is a `PriceBlock text`, the others grey lines)
- `faq`, `about` (`heading`, `portrait`, `portraitAlt`, `text[]`, `link { label, href }`), `contact` (single button)

**hire** (own `header { name, links, cta }`)
- `hero` (hire-hero): `name` (h1), `role`, `lead[]`, `portrait`, `portraitAlt`, `button { codeword, label, caption }`, `email { text, subject }`, `resumes[{ label, meta, href }]`
- `facts`: `anchor`, `heading`, `rows[{ label, value, extra?[], links?[{ label, url }] }]`
- `numbers`: `anchor`, `heading`, `items[]`, `note`
- `experience`: `anchor`, `heading`, `lead`, `caseDisplay { sections[], showReel, … }`, `items[{ id, dates, duration?, role, place, placeFull?, placeNote?, about, results?[], stack?, cases?[{ case, show: 'line' | 'full', links?, scheme? }] }]` (`line` shows `case.hire.line`; `full` shows the case sections without labels and without the service line; `scheme: true` adds the case's AgentsScheme under it at the full width)
- `testimonials`: `anchor`, `heading`, `hint`, `items[{ testimonial, company, relation }]` (a `Carousel`)
- `team` (columns): `anchor`, `heading`, `columns[{ title, text, link? { label, url } }]`, `process { heading, items[] }`
- `contact`: `button { codeword, label, caption }`, `email { text, subject }`, `telegramText`, `resumes[]`

**free** (/free/, decision 18)
- `intro`: `heading` (h1, «Бесплатно»), `lead` (one line)
- `items` (free-items): `items[{ id, anchor, kind, title, text, insideLabel, inside[], format, file, cover { src, alt }, downloadLabel, discuss { text, links[{ label, service }] } }]` (`FreeItem`; `format` «PDF, 15 страниц» is checked against the file; the field is `downloadLabel`, not `button`, because `button` strings are Telegram codewords in the validation)
- `contact` (contact-short, anchor `contact`): `heading`, `email`, `workload` (`ContactShort`, with the global price line)

**404**: `not-found`: `code`, `heading` (h1), `text`, `button { label, href }`, `links[{ label, href }]`

### 5.2 site (`site`)

`site { name, lang, ogImage }`, `contacts { telegram { handle, url, text }, email }`,
`header { name, links[], cta }` (links: Услуги, Кейсы, Мои продукты, Бесплатно), `footer { contacts { telegramLabel, telegramText, emailLabel, emailText }, links[], legend?, madeWith, copyright }` (`legend`: the line «Подчёркнуто как в школе: …» with `[слова|член]` tokens, `Parsed inline`),
`telegram { plainButton, copiedLabel, copiedMs, singleHint, gridHint, buttons[{ codeword, caption, template, service? }], productTemplate }`,
`email { line, short, mailto { subject, body }, defaultSubject }`,
`work { howWeStart { heading, steps[{ title, text }], consultationNote, prepare, workload { text } }, price, payment, languages }`.

### 5.3 services (7, `services`)

`title`, `short`, `codeword`, `anchor`, `line` (Обучение, Разработка),
`order`, `summary` (the italic one-liner of the card), `button` (verb label
of the visitor's action: «Записаться на консультацию», «Обсудить
AI-агентов», «Заказать аудит курса», «Обсудить курс», «Обсудить приложение»,
«Обсудить игру», «Заказать тренажёр»), `highlights[3]` (the card's three
points), `forWhom[]`, `youGet[]`, `duration`, `durationNote?`,
`steps[]`, `fromYou?`, `ai?`, `notIncluded[]`, `proofCases[]`,
`proofNotes? { caseSlug: note }`, `proofLinks?[{ label, url, note?, case?, product? }]`,
`proofProducts?[]`, `testimonials?[]`, `more? { label, url }`,
`related? { text, service?, case? }`, `price? { main, note?, more?[] }`
(decision 16 of 14.10; all seven services have one now: `main` the figure or
range, «15 000 ₽», «от 250 000 ₽», «70 000–100 000 ₽», `note` what it covers
in one short line, `more` sub-prices or variants as «что — цена»; the spaces
inside figures are non-breaking; without `price` the card shows
`site.work.price`), `scheme?` (`"ai-agents"` on ai-agents); body: one
paragraph (`bodyHtml`). Slugs and anchors: consulting, ai-agents, audit,
course, app, game, guide. Card (render_card): highlights, «Срок» and the
price block (render_price: main large, note under it, more as a small list),
the verb button. Home rows (price_line): the figure only. Full template order (render_service, inside
«Подробнее»): body, the scheme, «Для кого»,
«Что получите на руки», «Сколько длится» (`duration + '. ' + durationNote`),
«Как идёт работа» (numbered), «Что нужно от вас», «Что не входит»,
«Нейросеть и расходы» (`ai`), proof: for `app` first «Что можно открыть»
(`proofLinks`) then «Что я написал сам» (`proofCases`); for others «Чем
подтверждено» (published `proofCases` with notes, then `proofLinks`), then
«Мои продукты» (visible `proofProducts`: title and `oneLiner`); «Что говорят
коллеги» (`testimonials`).

### 5.4 cases (18 published, `cases`)

`title`, `shortTitle`, `origin`, `industry`, `year`, `duration?`, `direction`,
`service` (codeword), `anchor`, `status?` («в работе»), `featured`, `order`,
`published`, `hire? { place, line? }`, `links?[{ label, url, note? }]`,
`reel? { video, loop, poster }`, `scheme?` (`"ai-agents"`, staff-c2 only:
`AgentsScheme`), `infographic? { facts[2–4]{ value, label }, flow?[2–5], beforeAfter? { before, after } }`
(every case has one; facts only from the case text), `summary?` (the one
line of the /cases/ card: what was done and for whom; every published case
has it since the review of 14.10; without it the card shows the home line or
the first sentence of «Контекст»), `seo? { title?, description? }` (the case page's
search title and description; absent, `caseSeo` builds them), `testimonials?[]`,
`leadMagnet? { text, link? { label, href } }` (the line about the free guide
under the text; the label's words are in the text).
Every published case has the page /cases/<slug>/ (slug = file name).
Body sections: «Контекст», «Что сделал», «Результат», «Что из этого сделаю
для вас» (`bodySections`).

### 5.5 products (5, `products`)

`title`, `anchor`, `codeword`, `kind`, `status`, `platform`, `oneLiner`,
`inside`, `statusNote?`, `visible`, `action? { label, url }` (no action means
no button: the two party games), `secondaryLinks?[{ label, url, note? }]`,
`media { type, src, alt, status }` (the first gallery shot, or the one
screenshot), `gallery[{ type: image | video, src, poster?, alt, caption? }]`
(wishlist 5, Barba 4, Скрижаль 3, Top Pick and ДОБЕЙ 1; videos from Daniil
go first with a poster), `messageLink { label, template }`
(`productTemplate(p)`), `metrics[]`, `order`; body paragraphs (`bodyHtml`).
Product names use the huge size.

### 5.6 testimonials (5)

`name`, `role`, `company` (may be ''), `kind` (`video`), `video`, `loop`,
`poster`, `quote`, `pages[]`. Use `VideoTestimonial` (`layout="card"` in a `Carousel`).

## 6. CSS (`src/styles`)

`tokens.css` (custom properties) and `global.css` (reset, type, links, focus,
buttons, rules, grid, utilities) load in `BaseLayout`, then `accents.css`
(the underlines, below); `global.css` imports `motion.css` (decision 2 of
15.10: the hover fade and press scale of every button, the page-to-page view
transition, the closing state of the disclosures, no coloured tap highlight;
tokens `--dur-hover`, `--ease-out`, `--spring-release`, `--press-scale`,
`--dur-page`; everything that moves behind `prefers-reduced-motion:
no-preference`; it never sets `text-decoration`: the line of a link, its
style and its motion are `accents.css`). Components keep their own scoped
styles.

**Tokens.** Colour `--ink #000`, `--paper #fff`, `--muted #5e5e5e` (secondary
text), `--rule #c4c4c4` (hairlines). Fonts `--font-sans` (Inter Tight),
`--font-mono` (IBM Plex Mono), weights `--regular 400`, `--bold 700`. Sizes
`--fs-huge` 42–100px, `--fs-large` 28–50, `--fs-medium` 20–26, `--fs-base`
16–18, `--fs-small` 13 (fluid from 360 to 1440px), with `--lh-*` and
`--track-*`. `--measure 66ch`. Space `--s1 8px`, `--s2 16px`, `--s3 24–32`,
`--s4 40–64`, `--s5 64–112`. Layout `--max 1240px`, `--gutter` 16/32/48px,
`--gap` 16/24px, `--cols` 4/12, `--header-h`. Lines `--hair` (1px grey),
`--line` (1px ink).

**Accents (`accents.css`, decision 1 of 15.10).** Loaded by `BaseLayout`
right after `global.css` (it replaces the link underline there). No colour
accents: one underline style per member of the sentence, in currentColor,
sized in em (1px in body text, 4–5px at the huge size), never moving
layout.

| Member | Line | Class | Where |
| --- | --- | --- | --- |
| подлежащее | one solid line | `.u-subj` | the current page: `a[aria-current="page"]` and `.link-quiet[aria-current]` |
| сказуемое | two lines (double) | `.u-pred` | every `.btn` label (a plain button carries it itself; with a caption only `.btn__label` or `.tg-btn__word`), the action links `.tg-link` |
| дополнение | dashed | `.u-obj` | every `a` (the default link line) |
| определение | wavy | `.u-attr` | a link under the pointer (`hover: hover` only) or the keyboard focus; the FAQ question under the pointer; the title of a case step link (CaseFull) |
| обстоятельство | dash-dot | `.u-circ` | durations and prices: «Срок» (`ServiceTerms`), the price figure (`PriceBlock`), «Сколько длится», the case duration label (`CaseLabels`), the tenure on /hire/ |

Tokens: `--u-t` thickness `max(1px, 0.05em)`, `--u-t2` each double line
`max(1px, 0.035em)`, `--u-tw` wavy `max(1px, 0.04em)`, offsets `--u-o`
0.2em, `--u-o2` 0.16em, `--u-ow` 0.17em, dash-dot `--u-dash` 0.5em,
`--u-gap` 0.17em, `--u-descent` (0.24em Inter Tight, 0.28em on `.mono`,
`.label`, `.t-small`; set it on other mono text that carries `.u-circ`),
`--u-dur` 200ms and `--u-ease` (the wave's entrance). Override them on a
parent to tune a context. `.u-circ` is a background (a
repeating gradient in currentColor, not a native style): put it on an
inline span around the words, never on a block (and without side padding:
each line is its own box, `box-decoration-break: clone`); the period
stretches a fraction of a pixel so every line ends on a whole dash-dot
(`background-repeat: round`), never on a stub; forced colours and print
show a dotted line instead. Motion (only under `prefers-reduced-motion:
no-preference`): the wave fades in and settles (`u-wave-in`, offset and
colour), and colour, thickness and offset go back over `--dur-hover` /
`--ease-out` (the hover fade of `motion.css`) when the pointer or the focus
leaves; a `.btn` keeps the fill transition of `motion.css` (its lines never
change). The small framed controls that are not `.btn` («Подробнее» of a
disclosure, «Назад»/«Дальше» of a carousel, «Закрыть» of the lightbox) have
no lines: they toggle or move, they are not actions. Fallbacks: a browser
without `text-decoration-style` draws one solid line; without `:has()`
(Safari < 15.4, Firefox < 121) plain buttons have no double line.

**Type classes.** `h1`/`.t-huge`, `h2`/`.t-large`, `h3`/`.t-medium`,
`h4`/`.t-base`, `.t-small` (mono 13px), `.label` (mono small grey), `.mono`,
`.sans`, `.muted`, `.bold`, `.regular`, `.lead` (medium text, 34em),
`.measure`, `.nowrap`. Links are underlined dashed, wavy under the pointer
and the focus, solid on the current page; `.link-quiet` has no line at rest
(wavy on hover, solid with `aria-current="page"`).

**Buttons.** `.btn` (frame), `.btn--primary` (ink fill), `.btn--small`,
`.btn--block`, `.btn__caption` (mono second line), `.btn__label` (the label
beside a caption, for its double line). The label has two lines (accents).
Hover inverts colours (over a 160 ms fade); a press scales the frame to 0.97 and lets it go on a
spring (`motion.css`).
Focus: 2px ink outline, offset 3px, on everything.

**Rules and lists.** `hr`/`.rule` (hairline), `.rule--ink`, `.top-hair`,
`.top-line`; `.list-plain`; `.list-rules` (hairline between items and at the
end, `--s2` padding); `.list-comma` (inline list joined by commas);
`.list-dash` (a grey dash hangs in front of each item) and `.list-num` (a
small grey mono number in front of each item), both at `--measure`. Numbered
lists inside `.prose` get the same number treatment as `.list-num`.

**Grid.** `.wrap` (centred container with side gutters). `.grid`: 4 columns
below 720px, 12 from 720px; children span the full row unless given:
`.col-1`…`.col-12` and `.start-1`…`.start-12` (from 720px),
`.lg-col-1`…`.lg-col-12` and `.lg-start-*` (from 1080px), `.m-col-1`…`.m-col-4`
(below 720px). `.grid--tight` (row gap `--s2`), `.grid--flush` (no row gap).
Example: portrait 4 of 12 and text 8 of 12:

```html
<div class="grid">
  <div class="col-4 m-col-2">…</div>
  <div class="col-8">…</div>
</div>
```

`.cols` equal columns that wrap: `.cols-2`, `.cols-3` (from 720px), `.cols-4`
(2 from 720px, 4 from 1080px), `.m-cols-2` (2 below 720px).
`.scroll-row`: sideways scrolling row on phones and tablets (items 42% of
the row, at least 9.5rem; from 720px 28%, at least 11rem, so the row scrolls
instead of shrinking), an even row of `--row-items` (default 6) from 1080px
(reels).

**Spacing.** `.stack` with `.flow-1`…`.flow-5` (gap between children),
`.cluster` (wrapping flex row), `.mt-0`…`.mt-5`, `.mb-1`…`.mb-5`,
`.pt-3`…`.pt-5`, `.pb-3`…`.pb-5`, `.sr-only`.

## 7. Behaviour and analytics

Client scripts (each bundled only by the component that needs it; with
`prefers-reduced-motion` nothing in them animates). `src/scripts/carousel.ts`
(bundled by `Carousel` only on pages with a carousel: home, /products/, /hire/
and the case pages with testimonials) wires «Назад» and «Дальше», the arrow
keys and the counter, and loads Embla Carousel near the row when motion is
allowed (section 4, Carousel). `src/scripts/disclose.ts` (bundled by
`Disclosure`, /services/) shows the second «Свернуть» at the end of a long
disclosure and makes it close the details, focus the summary and jump to the
card's top (keeping the summary on screen); closing from the stuck summary
jumps back too (section 4, Disclosure). `src/scripts/accordion.ts` (used by
`disclose.ts` and by `FAQ`, /services/ and /guide/) opens and closes a
`<details>` on a spring (Motion's `motion/mini` animate and spring,
`src/scripts/motion-lite.ts`, loaded right after the page and only when
motion is allowed; until it has arrived, and with reduced motion, a click
toggles at once).
`src/scripts/lightbox.ts` (bundled by `components/motion/Lightbox.astro`,
/services/ and /products/) loads `lightbox-ui.ts` at the first pointer,
touch or focus on an `a[data-lightbox]` thumbnail and opens it in a native
modal `<dialog>` (section 4, Lightbox).
`src/scripts/telegram.ts` is bundled into every page by `BaseLayout`. It copies `data-tg-template` on click and swaps the
label for `data-tg-copied` during `data-tg-ms`, and, when `<html
data-metrika>` is set (production), sends `reachGoal` for elements with
`data-goal`: `telegram` (Telegram buttons and links), `email` (mailto links),
`hire` (footer link to /hire/), `product` (product buttons; pass
`goal="product"`), `download` (the PDF on /free/: the button and the cover;
Metrika's `trackLinks` also counts the file download by itself). A click on
any link to a demo app (`<base>demo/<name>/…`, from /products/, /services/,
/guide/, /hire/ and the case pages) also sends the goal `demo` with the
parameter `{ demo: "<name>" }`, next to the link's own goal if it has one (the
wishlist button on /products/ sends `product` and `demo`). The demo pages themselves are
legacy files and have no counter (production keeps them byte-identical to
`public/`), and `trackLinks` counts only links to other sites, so this goal is
the only record of demo visits from the site; a demo opened straight from a
link elsewhere is not counted. The goals exist in Metrika only after they are
added there as JavaScript events with these identifiers (README, the move
checklist). The home page: `src/scripts/glyphs/ascii-headline.ts` and
`dither-portrait.ts` (with `ascii-field.ts` and `core.ts`), bundled by
`AsciiHeadline` and `DitherPortrait` (section 4, docs/lab.md). Preview
builds only: the prototype A of /lab/ (`src/scripts/lab/`) and the comment
mode (below, injected by `tools/comment-mode.mjs`). No other scripts: no `/#hire` redirect, no autoplay; the
disclosures are native `<details>` that work without the scripts, the
screenshots are plain links without JS.

Page to page: cross-document view transitions (`@view-transition` in
`motion.css`, CSS only, motion allowed only): the header keeps its place,
the content cross-fades in 200 ms; browsers without support navigate as
before. Every navigation stays a real page load, so the Telegram script,
the Metrika counter (a page view per page) and the old home anchors work as
they are. Astro's `<ClientRouter />` was tried (15.10) and not taken: after
a soft navigation the module scripts of a page seen before do not run again
(the carousel and the disclosures stay dead), the Telegram script's live
region goes with the old `<body>`, and Metrika gets no page view; fixing it
means re-initialising every script on `astro:page-load` and sending
`ym(…, 'hit')` by hand.

### JS per page (measured 15.10, production build)

Raw/gzip KB at 375 px, external and inline scripts, Metrika's own tag.js
not counted; «scroll» is what loads while scrolling to the end, «lightbox»
what the first open of a screenshot adds. Staging adds the comment mode's
button, 3.0–4.7/1.5–2.3 KB per page; /lab/ (staging only) loads
29.5/13.9. Home measured again 15.10 evening, with the glyph h1 and the
one-bit portrait (21.5/9.8 of the 30.8/14.1; it loads with reduced motion
too, the pictures are static then).

| Page | Motion allowed: load + scroll | + lightbox | Reduced motion: load | + lightbox |
| --- | --- | --- | --- | --- |
| / | 30.8/14.1 + Embla 25.0/9.9 | | 30.8/14.1 | |
| /services/ | 19.3/8.8 | 5.8/2.6 | 7.7/4.1 | 5.8/2.6 |
| /products/ | 34.1/14.3 (Embla included: the galleries are in the first screen) | 17.5/7.3 | 9.1/4.4 | 5.8/2.6 |
| /guide/ | 17.5/7.8 | | 5.8/3.1 | |
| /hire/, /cases/staff-c3/ | 8.3/3.9 + Embla 25.0/9.9 | | 8.3/3.9 | |
| /cases/, /free/ | 2.0/1.1 | | 2.0/1.1 | |

Before the lightbox moved off React (same build otherwise): /products/
385.7/128.8 at load (360.6/118.8 with reduced motion), /services/
337.6/109.3 more near the screenshots; total blocking time on /products/
at 375 with 4× CPU slowdown, median of 5: 222 ms before, 88 ms after.

### Staging comment mode (decision 4 of 15.10, preview only)

`tools/comment-mode.mjs` is an Astro integration (in `astro.config.mjs`). In
preview builds and `npm run dev` it injects one bundled script into every
Astro page (`injectScript('page')`); with `PREVIEW=0` it does nothing, so the
production build has no trace of it (prodcheck checks both ways). No page,
layout or component includes it.

- `src/scripts/comment-mode.ts` (every page, about 5 KB, 2.4 KB gzip): the
  floating «Комментировать» button bottom right and «Список N» when comments
  wait, in a shadow root (`<div data-comment-mode>` at the end of `body`), and
  the shortcut Alt+Shift+C. It adds 84px under the footer
  (`body::after`) and `scroll-padding-bottom`, so the buttons never cover the
  end of a page or a focused element. Nothing else listens on the page outside
  the mode. Under automation (`navigator.webdriver`: `npm run shots`, other
  Playwright runs) it does nothing unless the address has `?comment`.
- `src/scripts/comment-mode-ui.ts` (loaded at the first press, about 20 KB,
  7.7 KB gzip) and `virtual:comment-mode-map` (8 KB, 2.7 KB gzip): the mode.
  While it is on, clicks, taps, Enter and Space select an element instead of
  acting (capture listeners on `document`, `preventDefault` and
  `stopImmediatePropagation`; a drag or a swipe longer than 10px selects
  nothing), the element under the pointer or the focus gets an outline
  (`[data-box]`), a click inside a link or a button selects the link or the
  button; arrows up and down widen and narrow, left and right go to siblings.
  The form: «Шире», «Уже», «Что поправить», «Отправить» (opens
  `https://github.com/imevstratov-pixel/portfolio-v2/issues/new` with title,
  body and `labels=правка` in a new tab), «В список», «Отмена». The list
  (localStorage `comment-mode:v1`, in memory when storage is blocked) shows
  numbered pins on its elements, «Отправить всё» (one issue), «Скопировать»
  (the issue text), «Очистить». An address over 7500 characters opens the
  issue with a short body and puts the full text in the clipboard. Esc closes
  the form, then the list, then the mode. No transitions or animations.
- The issue body, per comment: the comment as a quote, then «Страница» (the
  full address), «Экран» (viewport, DPR, mouse or touch, scroll, reduced
  motion), «Элемент», «Селектор» (unique: the id, else the shortest path to
  the nearest id), «Текст», «Ближайший заголовок», «Якорь», «Ссылка»,
  «Файл» (img, video), «data-*», «Код» and «Файл страницы». «Код» is exact:
  the integration maps each `.astro` file's scoped-style id (the
  `data-astro-cid-*` attribute Astro puts on every element a component
  renders, computed with `@astrojs/compiler-rs`, Astro's own compiler) to the
  file, and the classes the `<style>` blocks and `src/styles/*.css` define to
  their files; the element and its ancestors give the chain of components,
  innermost first («`src/components/TelegramButton.astro (.tg-btn)`,
  `src/components/services/ServiceCard.astro (.svc__cta)`, …»). The body ends
  with `<!-- comment-mode:v1 -->` and the build's commit (`GITHUB_SHA` in the
  workflow).
- Reading the comments: the open issues with the label «правка» in
  `imevstratov-pixel/portfolio-v2` (GitHub MCP `list_issues` with
  `labels: ["правка"]`). Content edits go to the annotated source and the
  export, never into `src/content` by hand.
- The label «правка» must exist in the repository (GitHub drops an unknown
  label from a new-issue link).

## 8. Routes

`src/pages/index.astro` (/), `services/`, `cases/`, `products/`, `free/`,
`hire/`, `guide/` (`index.astro` each), `cases/[slug].astro` (one page per published
case, /cases/<slug>/, slug = file name: `CaseFull` and `ContactShort`),
`404.astro`, `work.html.ts` (redirect to `/services/#formats` with meta
refresh, canonical and a link), and `lab/[...lab].astro` (/lab/, preview
builds only, linked from nowhere, noindex: the «cherry» prototypes of
decision 3 of 15.10, B and C of them on the home page since decision 6, see docs/lab.md; `getStaticPaths` returns nothing with
`PREVIEW=0`, `tools/lab-prune.mjs` drops its unreferenced JS from the
production `_astro/`, and prodcheck fails if either comes back). Every page
renders its content blocks in the content order, as the texts renderer does.

## 9. Static files (`public/`)

Copied from the old site with their relative paths (unchanged, except the
posters `assets/testimonials/posters/evgenia.jpg` and `liza.jpg`, re-cut from
a frame without the burned-in subtitles that named the person in full):
`assets/`
(reels, posters, case images, testimonial videos and posters, approach
images, portrait, og.jpg, both PDF résumés), `resume/`, `demo/`
(`/demo/ai-competencies/`, `/demo/chatgpt-praktikum/`, `/demo/wishlist/`),
`en/` with the root `styles.css`, `script.js`, `game.js` it loads, and
`.nojekyll`. Product screenshots: `/products/top-pick.jpg`,
`/products/dobei.jpg`. Reel 01 (`assets/reels/reel-c1.mp4`,
`assets/reels/loops/c1.mp4`, `assets/posters/c1.jpg`) is not copied: it is
hidden until re-recorded and nothing links to it.

Made for this site: `free/` holds the free materials of /free/,
`kak-razrabotat-onlajn-kurs.pdf` and its cover
`kak-razrabotat-onlajn-kurs-cover.jpg`, both written by
`tools/build-guide-pdf.mjs` (section 2) and committed; the PDF is not built
with the site.
