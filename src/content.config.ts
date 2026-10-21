// Content collections. The files in src/content are produced by the export
// script (see docs/components.md) and are never edited by hand.
//
// Typed collections (cases, services, products, testimonials, zadachki, matrices) describe the
// fields the components read; unknown extra fields are kept (loose objects),
// so a new field in the content does not silently disappear.
// pages and site vary per page, so only their common skeleton is typed.
// Cross-references between collections are checked in src/lib/content.ts,
// which fails the build on a missing slug or codeword.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// ids are the file names without .md (e.g. "staff-c2", "404", "global")
const loader = (dir: string) =>
  glob({
    pattern: '*.md',
    base: `./src/content/${dir}`,
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  });

const str = z.string();
const optStr = z.string().optional();
const link = z.looseObject({ label: str, url: str, note: optStr });

// Names of the drawn schemes (src/components/scheme/); "ai-agents" = AgentsScheme
const schemeName = z.enum(['ai-agents']);

const media = z.looseObject({
  type: optStr, // "screenshot" | "video" | ...
  src: z.string().default(''), // '' while the asset is pending: render nothing
  alt: z.string().default(''),
  status: optStr, // "ready" | "pending"
});

const pages = defineCollection({
  loader: loader('pages'),
  schema: z.looseObject({
    seo: z.looseObject({
      title: str,
      description: str,
      ogImage: optStr,
      ogImageAlt: optStr,
      noindex: z.boolean().optional(),
    }),
    header: z.looseObject({}).optional(),
    blocks: z.array(
      z.looseObject({
        id: str,
        type: str,
        anchor: optStr,
      }),
    ),
  }),
});

const telegramButton = z.looseObject({
  codeword: str,
  caption: str,
  template: str,
  service: optStr,
});

const site = defineCollection({
  loader: loader('site'),
  schema: z.looseObject({
    site: z.looseObject({ name: str, lang: str, ogImage: str, ogImageAlt: optStr }),
    contacts: z.looseObject({
      telegram: z.looseObject({ handle: str, url: str, text: str }),
      email: str,
    }),
    header: z.looseObject({
      name: z.looseObject({ label: str, href: str }),
      links: z.array(z.looseObject({ label: str, href: str })),
      cta: z.looseObject({ label: str, href: str }),
    }),
    footer: z.looseObject({
      contacts: z.looseObject({
        telegramLabel: str,
        telegramText: str,
        emailLabel: str,
        emailText: str,
      }),
      links: z.array(z.looseObject({ label: str, href: str })),
      madeWith: str,
      copyright: str,
    }),
    telegram: z.looseObject({
      plainButton: str,
      copiedLabel: str,
      copiedMs: z.number().int().positive(),
      singleHint: str,
      gridHint: str,
      buttons: z.array(telegramButton).min(1),
      productTemplate: str,
    }),
    email: z.looseObject({
      line: str,
      short: str,
      mailto: z.looseObject({ subject: str, body: str }),
      defaultSubject: str,
    }),
    work: z.looseObject({
      howWeStart: z.looseObject({
        heading: str,
        steps: z.array(z.looseObject({ title: str, text: str })),
        consultationNote: optStr,
        prepare: optStr,
        workload: z.looseObject({ text: str }).optional(),
      }),
      price: str,
      payment: str,
      languages: str,
    }),
  }),
});

const cases = defineCollection({
  loader: loader('cases'),
  schema: z.looseObject({
    title: str,
    shortTitle: str,
    origin: str,
    industry: str,
    year: z.coerce.string(),
    duration: optStr,
    direction: str,
    service: str, // a service codeword, e.g. "AI-агенты"
    anchor: str,
    status: optStr, // e.g. "в работе"
    featured: z.boolean().default(false),
    order: z.number(),
    published: z.boolean().default(true),
    hire: z.looseObject({ place: optStr, line: optStr }).nullish(),
    links: z.array(link).optional(),
    reel: z.looseObject({ video: str, loop: optStr, poster: str }).nullish(),
    // `scheme: "ai-agents"` shows the AgentsScheme component (staff-c2)
    scheme: schemeName.optional(),
    // facts strip under the title (decision 10 of 14.10): 2–4 facts from the
    // case text, optional steps and «было — стало»
    infographic: z
      .looseObject({
        facts: z.array(z.looseObject({ value: z.coerce.string(), label: str })).min(2).max(4),
        flow: z.array(str).min(2).max(5).optional(),
        beforeAfter: z.looseObject({ before: str, after: str }).optional(),
      })
      .optional(),
    // one line under the infographic on the /cases/ card (not in the content
    // yet: the card falls back to the first sentence of «Контекст»)
    summary: optStr,
    // search title and description of the case page /cases/<slug>/ (optional:
    // the page builds them from the title and the text, see caseSeo())
    seo: z.looseObject({ title: optStr, description: optStr }).optional(),
    testimonials: z.array(str).optional(),
    // a line under the case text about a free material (decision 18): the
    // words of `link.label` inside `text` become the link (LinkedText)
    leadMagnet: z.looseObject({ text: str, link: z.looseObject({ label: str, href: str }).optional() }).optional(),
  }),
});

const services = defineCollection({
  loader: loader('services'),
  schema: z.looseObject({
    title: str,
    short: str,
    codeword: str,
    anchor: str,
    line: str, // "Обучение" | "Разработка"
    order: z.number(),
    summary: str,
    // the compact card on /services/ (decisions 8 and 10 of 14.10)
    button: str, // verb label of the visitor's action, «Заказать аудит курса»
    highlights: z.array(str).length(3),
    forWhom: z.array(str),
    youGet: z.array(str),
    duration: str,
    durationNote: optStr,
    steps: z.array(str),
    fromYou: optStr,
    ai: optStr,
    notIncluded: z.array(str),
    proofCases: z.array(str).default([]),
    proofNotes: z.record(z.string(), z.string()).optional(),
    proofLinks: z
      .array(z.looseObject({ label: str, url: str, note: optStr, case: optStr, product: optStr }))
      .optional(),
    proofProducts: z.array(str).optional(),
    testimonials: z.array(str).optional(),
    more: z.looseObject({ label: str, url: str }).optional(),
    // the «new» sticker on the card (NewBadge)
    isNew: z.boolean().optional(),
    // the service's own page /services/<slug>/: search title, description,
    // and an h1 when it differs from `title` (the list keeps `title`)
    seo: z.looseObject({ title: optStr, description: optStr, h1: optStr }).optional(),
    related: z.looseObject({ text: str, service: optStr, case: optStr }).optional(),
    // price block of the card (decision 16 of 14.10): the figure or range
    // («15 000 ₽», «от 250 000 ₽», «70 000–100 000 ₽»), what it covers in one
    // short line, then sub-prices or variants; absent means the global line
    // (site work.price)
    price: z
      .looseObject({
        main: str,
        note: optStr,
        more: z.array(str).optional(),
      })
      .optional(),
    scheme: schemeName.optional(),
  }),
});

const products = defineCollection({
  loader: loader('products'),
  schema: z.looseObject({
    title: str,
    anchor: str,
    codeword: str,
    kind: str,
    status: str,
    platform: str,
    oneLiner: str,
    inside: str,
    statusNote: optStr,
    visible: z.boolean().default(true),
    action: z.looseObject({ label: str, url: str }).optional(),
    secondaryLinks: z.array(link).optional(),
    media: media.optional(),
    // screenshots and videos in order (the first one stands in for `media`)
    gallery: z
      .array(
        z.looseObject({
          type: z.enum(['image', 'video']).default('image'),
          src: str,
          poster: optStr,
          alt: z.string().default(''),
          caption: optStr,
        }),
      )
      .default([]),
    messageLink: z.looseObject({ label: str, template: str }),
    metrics: z.array(z.any()).default([]),
    order: z.number(),
  }),
});

const testimonials = defineCollection({
  loader: loader('testimonials'),
  schema: z.looseObject({
    name: str,
    role: str,
    company: z.string().default(''),
    kind: str, // "video"
    video: str,
    loop: optStr,
    poster: str,
    quote: str,
    pages: z.array(str).default([]),
  }),
});

// «Задачки» (SEO plan of 18.10): a made-up buyer task, Daniil's dictated
// solution in the body (h2 sections), the artifact; the page frame (plate,
// short answer, situation, the service, the experience line) comes from here
const zadachki = defineCollection({
  loader: loader('zadachki'),
  schema: z.looseObject({
    title: str, // h1 and <title>
    description: str,
    order: z.number(),
    date: str, // "2026-10-19"
    updated: optStr,
    service: str, // service slug
    short: str, // the short answer under the h1
    situation: str,
    constraints: z.array(str).default([]),
    artifact: z.looseObject({ title: str, widget: z.enum(['', 'payback']).optional() }),
    experience: z.looseObject({ text: str, case: optStr }).optional(),
    // the ink box under the «Что я спросил бы первым» cards: what the questions are for
    firstGoal: optStr,
    // schemes and small infographics drawn in HTML (ZFigure), placed at the
    // start of a body section («situation» = under «Ситуация»)
    figures: z
      .array(
        z.looseObject({
          section: str,
          type: z.enum(['bars', 'flow']),
          title: str,
          caption: optStr,
          unit: optStr,
          max: z.number().optional(),
          note: optStr,
          items: z.array(z.looseObject({ label: str, value: z.number().optional(), text: optStr })).min(2),
        }),
      )
      .default([]),
    // pictures in one bit (DitherPortrait): the cover under the head, images
    // at the end of their body section; files in public/
    cover: z.looseObject({ src: str, alt: str, crop: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }).optional(),
    images: z
      .array(
        z.looseObject({
          section: str,
          src: str,
          alt: str,
          caption: optStr,
          crop: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        }),
      )
      .default([]),
    visible: z.boolean().default(true),
  }),
});

// A free competency matrix on /free/<slug>/ (slug = file name): skills by
// category and grade, each one observable action checked yes/no; `key`
// items are required for the grade, `star` items may belong to another role
// in a team (struck out before counting). Prose around it (grades, how to
// use, what it does not cover, the custom version, how it was made) is data
// too, so links go through LinkedText. The Excel file for 1:1 meetings is
// built from the same file (tools/build-matrix-xlsx.py).
const textLink = z.looseObject({ label: str, service: optStr, case: optStr, href: optStr });
const linkedPara = z.looseObject({ text: str, links: z.array(textLink).default([]) });
const matrices = defineCollection({
  loader: loader('matrices'),
  schema: z.looseObject({
    title: str,
    seo: z.looseObject({ title: str, description: str }),
    date: str,
    version: optStr,
    lead: str,
    usesIntro: optStr,
    uses: z.array(str).default([]),
    self: optStr,
    learnerNote: optStr,
    gradesHeading: str,
    grades: z.array(z.looseObject({ name: str, text: str })).length(3),
    gradesNote: optStr,
    howHeading: str,
    steps: z.array(z.looseObject({ title: str, text: str, items: z.array(str).optional(), after: optStr })),
    howAfter: z.array(str).default([]),
    matrixHeading: str,
    legend: z.looseObject({ star: str, key: str }),
    categories: z.array(
      z.looseObject({
        id: str,
        title: str,
        skills: z.array(
          z.looseObject({
            id: str,
            grade: z.enum(['junior', 'middle', 'senior']),
            text: str,
            key: z.boolean().optional(),
            star: z.boolean().optional(),
            short: optStr, // key items: a short name for the evidence table
            evidence: optStr, // key items: what to ask to see
          }),
        ),
      }),
    ),
    keyHeading: str,
    notCoveredHeading: str,
    notCovered: z.array(str).default([]),
    custom: z.looseObject({ heading: str, paragraphs: z.array(linkedPara) }),
    made: z.looseObject({ heading: str, paragraphs: z.array(linkedPara) }),
    xlsx: z.looseObject({ file: str, label: str }),
    visible: z.boolean().default(true),
  }),
});

export const collections = { pages, site, cases, services, products, testimonials, zadachki, matrices };
