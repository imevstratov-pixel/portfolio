# /lab/: graphics from glyphs (decision 3 of 15.10)

A staging-only page with three prototypes of the «cherry». Daniil chose
(decision 6 of 15.10): B is the home h1, C the picture of «Обо мне», both
with the lab's default settings (section «On the home page» below). A stays
a prototype.

| | Component | Script (bundled only where used) | Where |
| --- | --- | --- | --- |
| A, the photo in glyphs | `src/components/lab/AsciiPortrait.astro` | `src/scripts/lab/ascii-portrait.ts` | /lab/ only |
| B, the first-screen phrase in glyphs | `src/components/glyphs/AsciiHeadline.astro` | `src/scripts/glyphs/ascii-headline.ts` | home hero, /lab/ |
| C, the photo in one bit | `src/components/glyphs/DitherPortrait.astro` | `src/scripts/glyphs/dither-portrait.ts` | home «Обо мне», /lab/ |

Shared code: `src/scripts/glyphs/core.ts` (reduced motion, forced colours,
colours from the tokens, lazy start, visibility, resize, yielding, the
cursor/finger lens, luminance and tone mapping) and
`src/scripts/glyphs/ascii-field.ts` (the glyph field of A and B: glyph
atlases, the still picture, the lens, the opt-in shimmer). Vanilla
TypeScript and Canvas 2D, no libraries. What ships to production lives in
`glyphs/`; `components/lab/` and `scripts/lab/` hold only what /lab/ alone
uses (A and the option buttons), so prodcheck's rule «no chunk named after
a file of `src/components/lab/` or `src/scripts/lab/`» still proves that
nothing of the lab page ships.

## The page

`src/pages/lab/[...lab].astro` builds /lab/ only when `PREVIEW` is on
(`getStaticPaths` returns no path with `PREVIEW=0`), so the production build
has no /lab/ and the sitemap (made from the built files) cannot list it;
`tools/lab-prune.mjs` drops A's script, which Astro bundles anyway.
Preview pages are noindex anyway and the page passes `noindex` too. Nothing
links to it: not in the header, the footer or any page. The pictures and the
phrase come from the content (pages/home.md: `about.portrait`, `about.photo`,
`hero.headline`). A and C start on the drawn portrait of the old site
(`assets/portrait.jpg`, a frontal face in flat tones, so the technique
reads); the selfie in the lift mirror (`about.photo`) hides the face behind
the phone and its flash and is a placeholder until a frontal photo exists
(the page says so). The «Фото» group switches between them, each whole or
closer (`data-src`, `data-crop` and the `aria-label` at once; the island
loads the picture and takes its ratio).
`LabControls.astro` renders the option buttons: toggle buttons
(`aria-pressed`) in named groups that set a data attribute on their
prototype (an option may set more attributes: its third item); each island
redraws when its attributes change. They are framed `.btn btn--small`
without the double line of a `.btn` (a scoped rule): they switch, they are
not actions (docs/components.md, Accents).
The page ends with «Цена кадра», the frame costs below, so Daniil chooses
with the numbers.

## Shared behaviour

- **Lens.** Under the mouse or pen (pointer events) or the finger (passive
  touch events: the page still scrolls), a soft lens: a Gaussian fisheye in
  A and B (the glyphs near the centre move apart and grow up to 1 + magnify,
  switch to a denser ramp with letters, a faint radial shade appears under
  them), a pattern change in C. It fades in and out in about 0.3 s.
- **Nothing moves by itself.** The picture changes only under the pointer
  or a finger (the site's motion rule, decision 2 of 15.10). The shimmer of
  A and B (every 140 ms about 0.3% of the glyphs swap for another glyph of
  the same density for about a second) is off by default: it is content
  that changes by itself 7 times a second without end, which WCAG 2.2.2
  (Pause, Stop, Hide) allows only with an on-page way to stop it, and it
  costs a phone about a fifth of its main thread on the first screen. The
  lab has a «Мерцание в покое» toggle to compare; production would need a
  visible pause control with it.
- **Reduced motion:** no lens, no shimmer, no fades: a still picture. The
  preference is followed live.
- **Forced colours** (Windows contrast themes): the canvases would keep the
  tokens' ink and paper, which the theme does not change (B was a white
  block with black glyphs on a black page). So under `forced-colors:
  active` the islands draw nothing (they start once the mode is off) and the
  CSS hides the canvas: B shows its real text in `CanvasText`, A and C their
  `<img>`.
- **Rendering:** frames only while the lens moves or fades (plus the
  shimmer's 7 fps tick when it is on); nothing off screen or in a
  background tab. A resize or a new option while B or C is off screen
  waits until it is back in view (IntersectionObserver).
- **Building without a long task:** B prepares its mask and coverage, then
  yields; the glyph field draws its still picture (A and B) in slices of
  about 400 glyphs and yields after 12 ms of drawing (`yieldTask` in
  core.ts). Until the new picture is complete the canvas keeps the old one
  (a resize never shows an empty frame) and the lens waits; then the canvas
  takes the new size and the picture in one animation frame, and only then
  B's text turns transparent (`set()` resolves true), so the swap from text
  to glyphs never shows a blank frame. A later build cancels an earlier one
  at its next yield. Canvases at the device pixel ratio, capped at 2 (a 3×
  phone gets 2×, still crisp, with 2.25× fewer pixels per frame) and at 1.5
  for B, redrawn after a resize or a change of screen density. The lens
  atlases (every glyph size the lens uses, A and B) are drawn ahead, one per
  idle moment after the picture is set, so the first touch does not stall
  (it took 775–960 ms at 4× CPU slowdown before). Lazy: an island starts
  400 px before it scrolls into view.
- **B on phones:** a glyph row is never shorter than 5.5 CSS px (`density`
  is capped by it: on a 375 px screen 11 and 15 draw as about 8; shorter
  rows turned the phrase into noise), and the faint dots around the letters
  (`halo: 'auto'`) show only where the rows are at least 6.5 CSS px (from
  about 720 px of width; on phones they merged with the letter fill) and
  the screen has at least 1.5 device px per CSS px (`HALO_DPR`). On a 1× or
  1.25× monitor (most Windows desktops) the dots are a pixel or two each and
  turned lines 2 and 3 of the hero («приносит деньги», «и не скамит
  студентов.») into noise at 1280, 1440 and 1920; without them the same
  density 11 reads at every one of these widths. On a 2× screen (a Mac, the
  lab as Daniil saw it) the hero keeps the dots. A window moved to a screen
  of another density redraws (`watchSize`).
- **B's letter fill follows the letter size** (`data-tint` unset): the flat
  grey under the glyphs is 0.13 at 144 px (9rem) and up, 0.4 at 48 px and
  below, linear between (0.29 at 88 px, the hero at 1280; 0.36 at 62 px,
  768; 0.4 on phones). The smaller the letters, the more the glyphs break
  the strokes up: with 0.13 the hero at 375 and at 1280 (88 px) did not
  read; with the stronger fill it reads at every width from 360 up, the
  glyph texture and the halo stay. A number in `data-tint` fixes it.
- **No layout shift:** the portraits are boxes with the photo's (or the
  crop's) aspect ratio from the build; the headline's height is the real
  text's.
- **Accessibility:** the canvases are `aria-hidden`. The portraits are
  `role="img"` with the photo's alt; the `<img>` inside is the pixel source and
  the fallback without JS (with scripts on it is transparent, so the colour
  photo never flashes). The headline keeps its real text in the DOM (any
  element via `as`, `h1` in a first screen): screen readers and search
  engines read it, it can be selected, and without JS it is a plain headline.
- **leakcheck:** the scripts never contain the word it greps for; page
  visibility is read as `visibilityState !== 'visible'`.

## Props

```astro
<AsciiPortrait src={photo.src} alt={photo.alt} width="30rem" mode="ink" cols={96} crop={[0.1, 0.12, 0.72, 0.62]} loading="eager" />
<AsciiHeadline text={hero.headline} as="h1" mode="ink" letters="clip" size="var(--fs-huge)" />
<DitherPortrait src={photo.src} alt={photo.alt} width="30rem" pixel={2} algo="atkinson" lens="fine" />
```

- AsciiPortrait: `src`, `alt`, `width` (CSS length or px), `mode` (`ink`
  black on white, `inverse` white on black), `cols` (glyphs per row, default
  80), `crop` ([x, y, w, h] fractions), `edges` (threshold of the stroke
  glyphs «/ \ | -» on contours, default 1.3, 0 off), `shimmer` (default
  false), `loading`.
- AsciiHeadline: `text`, `as`, `width`, `mode`, `letters` (`clip`: crisp
  letter edges filled with glyphs over a light flat fill, readable at phone
  sizes; `grid`: pure ASCII, one glyph per cell, strokes on the contours),
  `size` (CSS font size), `density` (glyph rows per font size, default 11,
  rows at least 5.5 CSS px), `halo` (faint dots around the letters: `'auto'`
  default, rows of 6.5 CSS px and 1.5 device px per CSS px; `true`, `false`), `shimmer` (default false).
- DitherPortrait: `src`, `alt`, `width`, `mode` (`inverse` is a negative),
  `pixel` (dither pixel in CSS px, snapped to device pixels, default 2),
  `algo` (`atkinson` error diffusion or `bayer` ordered 8×8), `lens` (`fine`
  3× finer, `coarse` 2× coarser, `swap` the other algorithm, `grey` the
  greyscale photo, `off`), `gamma`, `crop`, `loading`.

The `src` must be a file in `public/` on the same origin (the canvas reads
its pixels). Do not put a picture made only for /lab/ under `public/media/`:
leakcheck fails on files there that no production page references.

## Frame cost

rAF callback time while the pointer or a finger moves over each canvas for
3 s (`t/lab-perf.mjs` of the review, p95 in ms; headless Chromium renders
canvas in software, so a real GPU is faster, but the ratios hold; «4×» is
Chrome's CPU throttling, about a mid-range phone). Idle: no callbacks at
all for any of them (no shimmer), none off screen.

| | 1280, DPR 2 | 1280, DPR 2, 4× | 375, DPR 3, touch, 4× | first touch, 375, 4× |
| --- | --- | --- | --- | --- |
| A | 1.3 | 7.1 | 5.7 | |
| B | 3.9 | 19.6 | 15.6 | max 32 |
| B before (15.10, shimmer on, DPR 2, atlases on first touch) | 8.2 | 61 | 47 | 960 |
| C | 6.4 | 15.1 | 5.1 | |
| B in the hero (88 px at 1280, 43 px at 375) | 2.7 | 17.6 | 15.8 | max 26 |
| C in «Обо мне» (379 px wide at 1280, 164 at 375) | 3.1 | 10.2 | 3.9 | |

B is still the heaviest: per lens frame it cuts the glyphs of the letter
cells to the letter shapes with a destination-in composite over the lens box.
B is in the hero now: before the move to the live site, measure it on a real
mid-range Android phone;
the next cut, if it is needed, is to pre-clip the edge cells' glyphs once
(only cells on a letter's edge need cutting) so a lens frame has no
composite at all.

## On the home page (decision 6 of 15.10)

**Hero** (`src/components/home/Hero.astro`): the h1 is
`<AsciiHeadline text={headline} as="h1" id="hero-heading" size="var(--fs-huge)" width="10.5em" shimmer={false} />`,
the lab's defaults otherwise (`letters="clip"`, `density={11}`,
`halo="auto"`, `mode="ink"`; the dots show on 2× screens only, see «B on
phones»). The size is the hero's own type size
(42–100 px), not the lab's bigger default (44–144 px): at the lab size the
phrase took four lines and 506 px at 1280×800, and the lead and the button
fell below the first screen. 10.5 em keeps the hero's three balanced lines
on wide screens. The text is `headline` with a non-breaking space after a
one- or two-letter word («и не скамит» stays together, as the parse had
it); no underlines (the school parse `headlineParse` is no longer drawn).
`shimmer={false}` is the default, written out so nobody turns it on without
a pause control (decision 2: nothing on the site moves by itself; WCAG
2.2.2). The h1 keeps the real text (search engines, screen readers,
`aria-labelledby` of the hero); it shows as plain bold text until the fonts
are in and the canvas is drawn (about 0.15 s after the first paint on a
fast connection, about 1 s on 4G with a 4× slower CPU), without JS, and
under forced colours.

**«Обо мне»** (`src/components/home/About.astro`):
`<DitherPortrait src={photo.src} alt={photo.alt} />`, the lab's defaults
(`pixel={2}`, `algo="atkinson"`, `lens="fine"`, `mode="ink"`), the whole
photo in its own 4:5 box (the same column and box as the plain photo had,
no layout shift), lazy. The `<img>` stays the pixel source and the fallback
(no JS, forced colours: the greyscale photo); the box carries the alt. The
selfie in the lift mirror reads poorly in one bit: the face is behind the
phone and its flash, so the picture is a hand, a head with headphones and a
bright spot on a diagonal lift wall. Daniil chose his photo, so it stays;
`ONE_BIT = 'portrait'` in About.astro switches to the drawn portrait cropped
to the face, as /lab/ shows it by default (box 448:410). While the photo is
hidden in the content the drawn portrait shows whole (1:1).

Cost on the home page (production build, 375 px): the three scripts add
21.5/9.8 KB raw/gzip at load (30.8/14.1 with the carousel's, was 9.3/4.3).
Total blocking time at load with 4× CPU slowdown (median of 9, headless
Chromium): 299 ms at 375 and 255 ms at 1280, against 377 and 213 before
(the noise between runs is ±100 ms); no long task is longer than before
(before the slicing above B's build alone was one 250–350 ms task). C
builds when it comes near: three tasks of about 70 ms at 1280 with 4×, none
over 50 ms at 375. Lens frames: see «Frame cost».
