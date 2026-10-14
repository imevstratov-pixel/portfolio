// Shared prop types for components.

export type NavLink = { label: string; href: string };

/** Header content: site/global.md `header`, or a page's own header (pages/hire.md). */
export type HeaderData = {
  name: NavLink;
  links: NavLink[];
  cta: NavLink;
};

/** A number with its label and small source line (hero numbers, /hire/ numbers). */
export type NumberItem = { value: string; label: string; source?: string };

/** A question and its answer (FAQ blocks). */
export type FaqItem = { q: string; a: string; status?: string };
