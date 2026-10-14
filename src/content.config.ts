// Content collections. The files in src/content are produced by the export
// script (see docs/components.md) and are never edited by hand.
//
// Typed collections (cases, services, products, testimonials) describe the
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
    site: z.looseObject({ name: str, lang: str, ogImage: str }),
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

export const collections = { pages, site, cases, services, products, testimonials };
