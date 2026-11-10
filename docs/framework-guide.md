# Framework guide

## Design

Use the existing ink `#000`, paper `#fff`, secondary `#5e5e5e` and rule
`#c4c4c4`. Inter Tight carries the narrative; IBM Plex Mono identifies ranks,
framework aliases and captions. All copy is left aligned.

The memorable element is a large black-and-white tier board. Its letters
represent editorial priority for a first learning product, never effect size.
Each name opens its explanation. A product selector gives the beginner a
short route through the board; the complete reference remains available.
Each product explicitly names its recommended methods and their roles;
conditional additions are separate. The floating return link restores the
selected tier-list item and keyboard focus, or the board heading on direct entry.

```text
ASCII headline                   short promise
1-bit blocks                     start / product / PDF
story and outcome
S | result, alignment, practice, memory, feedback
A | specialist tools
B | programme and production models
C | narrow starting points
D | claims to avoid
product selector | applied stack and deliverables
framework reference | examples, steps, strengths, limits
1-bit practice | programme sequence
worksheet | fill and download a personal brief
sources
```

Preserve the site's existing four/twelve-column grid. Restrict reading text to
66ch. Do not add decorative cards, colours or animation timings. Use the
existing AsciiHeadline and DitherPortrait implementations. Retain native
details, links and inputs, visible focus and a complete no-script reading path.

## Content ownership

The original external `site-content` source is not present in this checkout or
available through the connected repository. New guide sources therefore live
in `content-source/frameworks/`. `tools/export-framework-guide.mjs` validates
them, writes the public JSON export and inserts one catalogue item without
rewriting the other materials. `npm run content` applies this overlay after
the existing external export, so re-exporting does not remove the guide.

Edit the source files, not `src/content/frameworks/guide.json` or the generated
catalogue item. The web page and PDF share the same exported content.
Three contextual service offers also share their copy: consultation after the
product cases, an audit after the sequencing section, and implementation after
the worksheet. The web uses base-aware service paths; PDF links use the public
site domain. Check these promises against the actual service pages when editing.

The guide is a beginner's editorial selection based on the supplied research.
Examples are explicitly fictional. Source links distinguish a model's author
description from experimental evidence for specific learning mechanisms.

## Updating and checking

1. Edit `content-source/frameworks/guide.json`, `editorial.json` or `sources.json`.
2. Run `npm run content:frameworks`. It checks IDs, tiers, source references,
   product-stack references and the seven-stack promise before export.
3. Run `npm run pdf:frameworks`. As with the other guide engine, Poppler
   (`pdfinfo`, `pdffonts`, `pdftoppm`) must be on PATH; `CHROMIUM_PATH` can
   select an installed Chromium executable. The PDF uses the same exported
   JSON, freezes the Bayer illustration for print, and writes its cover.
4. Check the PDF's page layout, then run the site's build, link checks,
   leakcheck and Astro diagnostics. Commit the sources, export, PDF and cover.

`/free/kak-sdelat-produkt-kotoryj-uchit/` is a static route beside the existing
matrix route. The guide's script adds product switching, search by text/tier,
hash-linked disclosures, and a browser-local worksheet with TXT download.
Without JavaScript all seven stacks and the native disclosures remain readable.
The worksheet uses only localStorage and does not submit data to a server.
Its form and fields opt out of Yandex session replay via `ym-hide-content`
and `ym-disable-keys`, following the [official markup documentation](https://yandex.ru/support/metrica/ru/webvisor/settings).

The existing `leakcheck.sh` needs Bash 4+ and GNU grep. On the macOS authoring
host its exact marker/media/XLSX checks were also run through a temporary
Python equivalent, followed by the unchanged `prodcheck.mjs`. CI runs the
original shell checks on Ubuntu.
