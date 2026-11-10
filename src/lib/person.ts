// schema.org Person for search engines (SEO plan of 21.10.2026): who the site
// is about, so Google can tell Daniil from his namesakes. One entity with a
// stable @id (<site>/#person), the same on every page that carries it:
// - the home page: WebSite + Person (personGraph);
// - /hire/: ProfilePage whose mainEntity is the Person (profilePageLd);
// - the author or provider of articles, services and free materials (person).
// Data: site/global.md `person` (jobTitle, alternateName, image, sameAs: only
// Daniil's own profiles). Yandex documents no Person support; the visible
// «Даниил (Данил) Евстратов» on /hire/ and in the footer is for it.
import { site } from './content';
import { publicFileExists } from './media';
import { absoluteUrl } from './url';

type Site = URL | string | undefined;

const data = site.person;
if (data?.image && !publicFileExists(data.image)) throw new Error(`person: site/global.md person.image "${data.image}" is not in public/`);

export function personId(siteUrl: Site): string {
  return absoluteUrl('/', siteUrl) + '#person';
}

/** The full Person object (used inline wherever a page names Daniil). */
export function person(siteUrl: Site): Record<string, unknown> {
  return {
    '@type': 'Person',
    '@id': personId(siteUrl),
    name: site.site.name,
    ...(data?.alternateName.length ? { alternateName: data.alternateName } : {}),
    ...(data?.jobTitle ? { jobTitle: data.jobTitle } : {}),
    url: absoluteUrl('/hire/', siteUrl),
    ...(data?.image ? { image: absoluteUrl(data.image, siteUrl) } : {}),
    ...(data?.sameAs.length ? { sameAs: data.sameAs } : {}),
  };
}

/** Home page: the site and its person. */
export function personGraph(siteUrl: Site): Record<string, unknown> {
  const home = absoluteUrl('/', siteUrl);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': home + '#website',
        name: site.site.name,
        ...(data?.alternateName.length ? { alternateName: data.alternateName } : {}),
        url: home,
        inLanguage: site.site.lang,
        publisher: { '@id': personId(siteUrl) },
      },
      person(siteUrl),
    ],
  };
}

/** /hire/: a profile page about the person. */
export function profilePageLd(siteUrl: Site, pageUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: pageUrl,
    inLanguage: site.site.lang,
    mainEntity: person(siteUrl),
  };
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export function ldJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
