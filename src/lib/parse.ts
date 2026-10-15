// The school sentence parse in the content (decision 1 of 15.10): a line with
// inline tokens «[слова|роль]» marks the members of the sentence, which the
// site underlines in their school style (src/styles/accents.css):
//
//   подлежащее      .u-subj  one solid line
//   сказуемое       .u-pred  two lines
//   дополнение      .u-obj   dashed
//   определение     .u-attr  wavy
//   обстоятельство  .u-circ  dash-dot
//
//   headline:      "Образование, которое приносит деньги и не скамит студентов."
//   headlineParse: "[Образование|подлежащее], [которое|подлежащее] [приносит|сказуемое] …"
//
// The words outside the tokens and inside them are kept exactly. When the
// parse belongs to a plain field (the hero headline), the plain field stays
// the approved text: the parse must read exactly as it with the tokens taken
// out, or the build fails (so a new headline never shows an old parse).
// Render with components/Parsed.astro.

export type Role = 'subject' | 'predicate' | 'object' | 'attribute' | 'circumstance';
export type ParsePart = { text: string; role?: Role };

export const ROLE_CLASS: Record<Role, string> = {
  subject: 'u-subj',
  predicate: 'u-pred',
  object: 'u-obj',
  attribute: 'u-attr',
  circumstance: 'u-circ',
};

const ROLES: Record<string, Role> = {
  подлежащее: 'subject',
  сказуемое: 'predicate',
  дополнение: 'object',
  определение: 'attribute',
  обстоятельство: 'circumstance',
};

const TOKEN = /\[([^[\]|]+)\|([^[\]|]+)\]/g;

/** Split a marked line into parts. `plain`: the approved text it must read as. */
export function parseSentence(marked: string, plain?: string, where = 'content'): ParsePart[] {
  const parts: ParsePart[] = [];
  let last = 0;
  for (const m of marked.matchAll(TOKEN)) {
    const role = ROLES[m[2].trim().toLowerCase()];
    if (!role) {
      throw new Error(
        `${where}: unknown member «${m[2]}» in «${m[0]}»; use one of ${Object.keys(ROLES).join(', ')}`,
      );
    }
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: marked.slice(last, at) });
    parts.push({ text: m[1], role });
    last = at + m[0].length;
  }
  if (last < marked.length) parts.push({ text: marked.slice(last) });
  const text = parts.map((p) => p.text).join('');
  if (/[[\]|]/.test(text)) {
    throw new Error(`${where}: a broken token in «${marked}» (write [слова|роль])`);
  }
  if (plain !== undefined && text !== plain) {
    throw new Error(
      `${where}: the parse reads «${text}», the approved text is «${plain}»; update the parse with the text`,
    );
  }
  return parts;
}

/** The marked line without its tokens: the plain text. */
export function plainText(marked: string): string {
  return parseSentence(marked).map((p) => p.text).join('');
}
