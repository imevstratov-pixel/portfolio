// «AI строит быстро. Как сделать, чтобы он строил то, что нужно»: the second
// free guide, Daniil's method of working with an AI agent (16–17.10.2026).
//
// Its own blocks:
// - the cover: three numbers counted from the draft (techniques, errors,
//   templates); the build stops when «Что внутри» promises other numbers;
// - labelled rows: a paragraph that starts with a bold label from LABELS
//   («**Ситуация.** …», «**Симптом.** …») becomes a two-column row, the label
//   in small mono on the left; a list right after an empty label joins its row;
// - numbered headings: «#### 1. …» (techniques), «Ошибка N.», «Шаблон N.»,
//   «Принцип N.», «Упражнение N.» get the number or the tag in small mono;
// - ```scheme blocks become black-and-white figures (tiles, bars, cycle,
//   ladder, path, table), drawn in HTML and CSS, so the text stays text in the
//   PDF; ```text blocks (the templates) become framed mono boxes.
// Figures follow the site's system: ink on paper, greys for secondary marks,
// hairlines, square ends (no rounded corners), numbers in mono, one series
// per chart, a value label at each bar's tip.
import { section } from './engine.mjs';

const LABELS = [
  'Тезис', 'Почему', 'Пример', 'С чего начать завтра', 'Где в гайде',
  'Ситуация', 'Как делаю', 'Почему работает', 'Где ломается', 'Ступень', 'Попробуйте',
  'Симптом', 'Причина', 'Правило', 'Статус',
  'Задача', 'Как работал', 'Для методиста', 'Результат', 'Что переносимо', 'Цена и урок', 'Ограничения',
];
// rows that take the plain paragraphs and figures after them, up to the next
// row or heading (a case's «Результат» runs over several paragraphs)
const ABSORB = new Set(['Результат']);

// the counts the cover shows, and the words «Что внутри» uses for them
const COUNTS = [
  { key: 'techniques', word: 'приём', forms: ['приём', 'приёма', 'приёмов'], text: 'по шести шагам работы: от постановки задачи до закрепления' },
  { key: 'errors', word: 'ошиб', forms: ['ошибка', 'ошибки', 'ошибок'], text: 'моих и модели, и правила, которые из них выросли' },
  { key: 'templates', word: 'шаблон', forms: ['шаблон', 'шаблона', 'шаблонов'], text: 'брифа и проверки, плюс чек-листы в шпаргалке' },
];

// Arrows are not in the site's font subsets (Inter Tight and IBM Plex Mono from
// @fontsource cover Latin and Cyrillic only), so → ← ↑ ↓ ↔ are drawn as small
// inline SVGs in the text colour; the PDF then embeds no fallback font.
const ARROW_PATHS = {
  '→': 'M1 5h11M8.5 1.5L12 5 8.5 8.5',
  '←': 'M13 5H2M5.5 1.5L2 5l3.5 3.5',
  '↔': 'M2 5h10M5.5 1.5L2 5l3.5 3.5M8.5 1.5L12 5 8.5 8.5',
  '↑': 'M7 9.5V0.5M3.5 4L7 0.5 10.5 4',
  '↓': 'M7 0.5v9M3.5 6L7 9.5 10.5 6',
};
const arrowSvg = (ch) =>
  `<svg class="arr" viewBox="0 0 14 10" role="img" aria-label="${ch}"><path d="${ARROW_PATHS[ch]}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="square"/></svg>`;
const arrows = (html) => html.replace(/(^|>)([^<]+)(?=<|$)/g, (_, a, t) => a + t.replace(/[→←↔↑↓]/g, arrowSvg));

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* --------------------------------------------------------- the figures */

/** «```scheme» text → { id, type, title, data: [lines], caption }. */
function parseScheme(src) {
  const out = { data: [] };
  let inData = false;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const m = /^(id|тип|заголовок|данные|подпись):\s*(.*)$/.exec(line.trim());
    if (m) {
      const [, k, v] = m;
      inData = k === 'данные';
      if (k === 'id') out.id = v;
      if (k === 'тип') out.type = v;
      if (k === 'заголовок') out.title = v;
      if (k === 'подпись') out.caption = v;
      if (k === 'данные' && v) out.data.push(v);
      continue;
    }
    if (inData && line.trim()) out.data.push(line.trim());
  }
  return out;
}

const NUM = /(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/;
const num = (s) => Number(s.replace(',', '.'));
const isValueFirst = (s) => /^(?:около |не меньше |примерно |до )?\d/.test(s);

/** A bar row: «Апрель — 121 — note», «Зачем — около 30 из 50 стартов», «57% — бот». */
function parseBar(line) {
  const seg = line.split(' — ');
  let label;
  let value;
  let note = '';
  if (isValueFirst(seg[0])) {
    value = seg[0];
    label = seg[1] ?? '';
    note = seg.slice(2).join(' — ');
  } else {
    label = seg[0];
    value = seg[1] ?? '';
    note = seg.slice(2).join(' — ');
  }
  const m = NUM.exec(value);
  if (!m) throw new Error(`scheme bars: no number in «${line}»`);
  const of = /из\s+(\d+)/.exec(value);
  // «57%» is drawn against 100%, «около 30 из 50» against 50
  return { label, value, note, lo: num(m[1]), hi: m[2] ? num(m[2]) : null, of: of ? Number(of[1]) : /%/.test(value) ? 100 : null };
}

/** «1. Name — text» → { n, name, text }. */
function parseStep(line) {
  const m = /^(\d+)\.\s+(.*)$/.exec(line);
  const body = m ? m[2] : line;
  const [name, ...rest] = body.split(' — ');
  return { n: m ? m[1] : '', name, text: rest.join(' — ') };
}

function figTiles(s, e) {
  const tiles = s.data.map((l) => {
    const [v, ...rest] = l.split(' — ');
    return `<li class="tile"><p class="tile__v">${e(v)}</p><p class="tile__l">${e(rest.join(' — '))}</p></li>`;
  });
  return `<ul class="tiles" role="list">${tiles.join('')}</ul>`;
}

function figBars(s, e) {
  const rows = s.data.map(parseBar);
  const max = Math.max(...rows.map((r) => Math.max(r.of ?? 0, r.hi ?? r.lo)));
  // the longest bar takes 70% of the track: its value label still fits after it
  const pct = (v) => `${((v / max) * 70).toFixed(2)}%`;
  const out = rows.map((r) => {
    // a zero is a hairline tick at the origin, so the value keeps its place
    const solid = `<span class="bar__fill" style="width:${r.lo ? pct(r.lo) : '0.35mm'}"></span>`;
    const range = r.hi ? `<span class="bar__range" style="width:${pct(r.hi - r.lo)}"></span>` : '';
    return `<li class="bar">
<p class="bar__label">${e(r.label)}</p>
<div class="bar__track">${solid}${range}<span class="bar__v">${e(r.value)}</span></div>
${r.note ? `<p class="bar__note">${e(r.note)}</p>` : ''}
</li>`;
  });
  return `<ol class="bars${rows.some((r) => r.note) ? ' bars--notes' : ''}" role="list">${out.join('')}</ol>`;
}

// six steps as a loop: 1 → 2 → 3 on top, 4 ← 5 ← 6 below, back up to 1
function figCycle(s, e) {
  const steps = s.data.filter((l) => /^\d+\./.test(l)).map(parseStep);
  const back = s.data.find((l) => l.startsWith('→'));
  if (steps.length !== 6) throw new Error(`scheme cycle ${s.id}: 6 steps expected, got ${steps.length}`);
  const box = (st) => `<div class="cyc__box"><p class="cyc__n">${e(st.n)}</p><p class="cyc__name">${e(st.name)}</p><p class="cyc__t">${e(st.text)}</p></div>`;
  const [a, b, c, d, f, g] = steps;
  return `<div class="cyc">
${box(a)}<span class="cyc__arr">→</span>${box(b)}<span class="cyc__arr">→</span>${box(c)}
<span class="cyc__up">↑</span><span></span><span></span><span></span><span class="cyc__down">↓</span>
${box(g)}<span class="cyc__arr">←</span>${box(f)}<span class="cyc__arr">←</span>${box(d)}
</div>${back ? `<p class="cyc__back">${e(back)}</p>` : ''}`;
}

// steps of a staircase, lowest on the left
function figLadder(s, e) {
  const steps = s.data.map(parseStep);
  const cols = steps.map(
    (st, i) =>
      `<li class="lad__step" style="--h:${20 + i * 11}mm"><p class="lad__n">${e(st.n)}</p><p class="lad__name">${e(st.name)}</p><p class="lad__t">${e(st.text)}</p></li>`,
  );
  return `<ol class="lad" role="list" style="--cols:${steps.length}">${cols.join('')}</ol>`;
}

// a chain of steps: in a row up to four, a column for more
function figPath(s, e) {
  const steps = s.data.map(parseStep);
  if (steps.length <= 4) {
    const items = steps.map(
      (st, i) =>
        `${i ? '<span class="path__arr">→</span>' : ''}<div class="path__box"><p class="path__n">${e(st.n)}</p><p class="path__name">${e(st.name)}</p>${st.text ? `<p class="path__t">${e(st.text)}</p>` : ''}</div>`,
    );
    const cols = steps.map(() => 'minmax(0, 1fr)').join(' 6mm ');
    return `<div class="path path--row" style="grid-template-columns:${cols}">${items.join('')}</div>`;
  }
  const items = steps.map(
    (st) => `<li class="vpath__i"><p class="vpath__n">${e(st.n)}</p><p class="vpath__t"><strong>${e(st.name)}</strong>${st.text ? ` — ${e(st.text)}` : ''}</p></li>`,
  );
  return `<ol class="vpath" role="list">${items.join('')}</ol>`;
}

function figTable(s, e) {
  const rows = s.data.map((l) => l.split('|').map((c) => c.trim()));
  return `<table class="ftable">${rows.map((r) => `<tr>${r.map((c, j) => `<td${j ? '' : ' class="ftable__k"'}>${e(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

const FIGURES = { плитки: figTiles, столбики: figBars, цикл: figCycle, лестница: figLadder, путь: figPath, таблица: figTable };

function figure(src, e, heading = '') {
  const s = parseScheme(src);
  if (heading && s.title && heading.replace(/^\d+\.\s*/, '') === s.title) s.title = '';
  const draw = FIGURES[s.type];
  if (!draw) throw new Error(`scheme ${s.id}: unknown type «${s.type}»`);
  if (!s.data.length) throw new Error(`scheme ${s.id}: no data`);
  return `<figure class="fig fig--${s.id ?? 'x'}${s.title ? '' : ' fig--untitled'}">
${s.title ? `<p class="fig__title">${e(s.title)}</p>` : ''}
${draw(s, e)}
${s.caption ? `<figcaption class="fig__cap">${e(s.caption)}</figcaption>` : ''}
</figure>`;
}

/* ------------------------------------------------------- the blocks */

/** Top-level blocks of satteri's HTML: [{ tag, html }]. */
function blocks(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<', i);
    if (start < 0) break;
    const m = /^<([a-z][a-z0-9]*)\b/.exec(html.slice(start));
    if (!m) {
      i = start + 1;
      continue;
    }
    const tag = m[1];
    // find the matching close tag, counting nested ones of the same name
    const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let x; (x = re.exec(html)); ) {
      depth += x[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = x.index + x[0].length;
        break;
      }
    }
    if (end < 0) {
      // a void element or an unclosed one: up to the end of the line
      end = html.indexOf('\n', start);
      if (end < 0) end = html.length;
    }
    out.push({ tag, html: html.slice(start, end) });
    i = end;
  }
  return out;
}

const LABEL_RE = new RegExp(`^<p><strong>(${LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[.:]</strong>\\s*([\\s\\S]*)</p>$`);

/** Labelled rows: «**Ситуация.** text» → a two-column row. */
function rows(html) {
  const bs = blocks(html);
  const out = [];
  for (let k = 0; k < bs.length; k++) {
    const m = LABEL_RE.exec(bs[k].html);
    if (!m) {
      out.push(bs[k].html);
      continue;
    }
    const [, label, rest] = m;
    let body = rest.trim() ? `<p>${rest.trim()}</p>` : '';
    // lists and figures right after the label belong to the row; a row in
    // ABSORB also takes the plain paragraphs that follow it
    const takes = (b) => /^(ul|ol|figure)$/.test(b.tag) || (ABSORB.has(label) && b.tag === 'p' && !LABEL_RE.test(b.html));
    while (k + 1 < bs.length && takes(bs[k + 1])) body += bs[++k].html;
    // the last row of a card stays with the row before it
    const last = !(k + 1 < bs.length && LABEL_RE.test(bs[k + 1].html));
    out.push(`<div class="row${last ? ' row--last' : ''}"><p class="row__l">${label}</p><div class="row__t">${body}</div></div>`);
  }
  return out.join('\n');
}

/* --------------------------------------------------------- the config */

export default {
  slug: 'ai-stroit-bystro',
  utm: 'utm_source=ai-guide-pdf&utm_medium=pdf',
  author: 'Даниил Евстратов',
  role: 'методолог образовательных продуктов',
  // a new page for chapter 1 (after the contents), the appendix, the
  // glossary and the reading list; the chapters follow on, so no page is
  // left half empty
  pageBreakBefore: ['1. ', 'Приложение', 'Словарь', 'Что почитать'],

  check(md, problems) {
    const sub = /^#\s.+\n+([^#\n].+)\n/.exec(md);
    if (!sub) problems.push('no subtitle line right after the title');
    const counts = {
      techniques: (section(md, '4') ?? '').match(/^#### \d+\.\s/gm)?.length ?? 0,
      errors: (section(md, '5') ?? '').match(/^#### Ошибка \d+\./gm)?.length ?? 0,
      templates: (md.match(/^#### Шаблон \d+\./gm) ?? []).length,
      cases: Math.max(0, ((section(md, '6') ?? '').match(/^### /gm)?.length ?? 0) - 1),
      exercises: (md.match(/^### Упражнение \d+\./gm) ?? []).length,
    };
    // «Что внутри» promises «18 приёмов, 9 ошибок …, 4 кейса, …, 5 шаблонов, 3 упражнения…»
    const promise = /(\d+) приём\S*, (\d+) ошиб\S*[^,]*, (\d+) кейс\S*, [^,]+, (\d+) шаблон\S*,? (?:и )?(\d+) упражнен/.exec(md);
    if (!promise) problems.push('«Что внутри»: the line with the numbers (приёмов, ошибок, кейсов, шаблонов, упражнений) not found');
    else {
      const want = { techniques: +promise[1], errors: +promise[2], cases: +promise[3], templates: +promise[4], exercises: +promise[5] };
      for (const [k, v] of Object.entries(want)) if (counts[k] !== v) problems.push(`«Что внутри» says ${v} ${k}, the draft has ${counts[k]}`);
    }
    for (const m of md.matchAll(/```scheme\n([\s\S]*?)```/g)) {
      try {
        figure(m[1], (x) => x);
      } catch (err) {
        problems.push(err.message);
      }
    }
    return { subtitle: sub?.[1] ?? '', counts };
  },

  // the subtitle goes on the cover; «Что внутри» is the intro of page 2 (no heading)
  prepare(md, ctx) {
    return md.replace(`${ctx.subtitle}\n`, '').replace(/^## Что внутри\n+/m, '');
  },

  transform(html, h) {
    let out = html;
    out = out.replace(/<pre><code class="language-scheme">([\s\S]*?)<\/code><\/pre>/g, (_, src, offset, whole) => {
      // the nearest heading before the figure: its title is not repeated
      const before = whole.slice(0, offset);
      const at = Math.max(before.lastIndexOf('<h2'), before.lastIndexOf('<h3'), before.lastIndexOf('<h4'));
      const head = at >= 0 ? /^<(h[2-4])[^>]*>([\s\S]*?)<\/\1>/.exec(before.slice(at)) : null;
      return figure(unescape(src), h.escapeHtml, head ? h.textOf(head[2]) : '');
    });
    out = out.replace(/<pre><code class="language-text">([\s\S]*?)<\/code><\/pre>/g, (_, src) => `<pre class="tpl"><code>${src.replace(/\n$/, '')}</code></pre>`);
    // techniques «#### 1. …»: the number in small mono
    out = out.replace(/<h4>(\d+)\.\s+([\s\S]*?)<\/h4>/g, (_, n, inner) => `<h4 class="step" id="tech-${n}"><span class="step__n">${n}</span><span class="step__t">${inner}</span></h4>`);
    // a short list (up to five items) is not split over two pages
    out = out.replace(/<(ul|ol)>((?:(?!<\/?(?:ul|ol)>)[\s\S])*)<\/\1>/g, (all, tag, inner) =>
      (inner.match(/<li>/g) ?? []).length <= 5 && inner.replace(/<[^>]+>/g, '').length <= 600 ? `<${tag} class="keep">${inner}</${tag}>` : all,
    );
    // the glossary: a hanging indent instead of dashes
    out = out.replace(/(<h2[^>]*>Словарь<\/h2>[\s\S]*?)<ul>/, '$1<ul class="gloss">');
    // text outside templates: reference numbers stay with their noun
    // («ошибка 3», «шаблон 5»), «по-английски» does not break at its hyphen,
    // a quoted phrase with an arrow stays on one line, inline <slots> in mono
    out = out.replace(/(<pre[\s\S]*?<\/pre>)|(^|>)([^<]+)(?=<|$)/g, (all, pre, a, t) => {
      if (pre) return pre;
      let x = t.replace(/(^|[^A-Za-zА-Яа-яЁё])((?:при[её]м|ошибк|шаблон|принцип|упражнени|глав|правил|ступен|кейс)[а-яё]*) (?=\d)/giu, '$1$2\u00a0');
      x = x.replace(/(^|[^A-Za-zА-Яа-яЁё])(по-(?:русски|английски))/g, '$1<span class="nw">$2</span>');
      x = x.replace(/«[^«»]{1,30}[→←↔][^«»]{1,30}»/g, (q) => `<span class="nw">${q}</span>`);
      x = x.replace(/(\S+) &lt;([^&]{1,30})&gt;/g, '$1\u00a0<code class="slot">&lt;$2&gt;</code>');
      return a + x;
    });
    // «Что почитать»: «…: <a>A</a>, по-английски — <a>B</a>.» becomes two
    // labelled lines under the item (ru / en, from each address)
    out = out.replace(/<a href="([^"]+)">([^<]+)<\/a>, <span class="nw">по-(?:русски|английски)<\/span> — <a href="([^"]+)">([^<]+)<\/a>\.?/g, (_, h1, t1, h2, t2) => {
      const lang = (href) => (/\/en\//.test(href) ? 'en' : 'ru');
      const line = (href, text) => `<span class="links__l">${lang(href)}</span><a href="${href}">${text}</a>`;
      return `<span class="links">${line(h1, t1)}${line(h2, t2)}</span>`;
    });
    // «Где в гайде»: the references are links inside the PDF
    const ANCHOR = { приём: 'tech', ошибка: 'err', шаблон: 'tpl', принцип: 'pr', упражнение: 'ex', глава: 'part' };
    // «Ошибка 1. …», «Шаблон 1. …», «Принцип 1. …», «Упражнение 1. …»: the tag above the title
    const ID = { Ошибка: 'err', Шаблон: 'tpl', Принцип: 'pr', Упражнение: 'ex' };
    out = out.replace(/<(h[34])>(Ошибка|Шаблон|Принцип|Упражнение)[ \u00a0](\d+)\.\s+([\s\S]*?)<\/\1>/g, (_, tag, kind, n, inner) => `<${tag} class="tagged" id="${ID[kind]}-${n}"><span class="tag">${kind} ${n}</span>${inner}</${tag}>`);
    out = rows(out);
    out = out.replace(/(<p class="row__l">Где в гайде<\/p><div class="row__t">)([\s\S]*?)(<\/div><\/div>)/g, (_, a, body, z) =>
      a + body.replace(/(при[её]м|ошибка|шаблон|принцип|упражнение|глава)\u00a0(\d+)/g, (m, w, n) => `<a class="ref" href="#${ANCHOR[/^при[её]м$/.test(w) ? 'приём' : w]}-${n}">${m}</a>`) + z,
    );
    return arrows(out);
  },

  cover(ctx, h) {
    const items = COUNTS.map((c) => {
      const n = ctx.counts[c.key];
      return `<li><p class="stage__v"><span class="stage__n">${n}</span> <span class="stage__u">${h.plural(n, c.forms)}</span></p><p class="stage__text">${h.typeset(c.text)}</p></li>`;
    }).join('\n');
    return `  <p class="cover__label">Бесплатное руководство</p>
  <div class="cover__main">
    <h1 class="cover__title cover__title--long">${h.escapeHtml(h.typeset(h.title))}</h1>
    <p class="cover__for">${h.escapeHtml(h.typeset(ctx.subtitle))}</p>
  </div>
  <ol class="cover__stages" role="list">${items}</ol>
  <div class="cover__foot">
    <p><strong>${this.author}</strong><br>${this.role}</p>
    <p class="cover__site"><a href="${h.escapeHtml(h.siteHref)}">${h.siteLabel}</a></p>
  </div>`;
  },

  meta(ctx, title) {
    return {
      Title: title,
      Author: 'Даниил Евстратов',
      Subject: `Руководство: как методолог работает с AI-агентом. ${ctx.counts.techniques} приёмов, ${ctx.counts.errors} ошибок с правилами, ${ctx.counts.templates} шаблонов`,
      Keywords: 'AI-агент, Claude, Claude Code, промпт, бриф, методолог, методист, EdTech, скиллы, автоматизация',
    };
  },

  report(ctx, html) {
    const c = ctx.counts;
    return [
      `counts: ${c.techniques} techniques, ${c.errors} errors, ${c.cases} cases, ${c.templates} templates, ${c.exercises} exercises`,
      `figures: ${(html.match(/<figure class="fig /g) ?? []).length}, labelled rows: ${(html.match(/class="row"/g) ?? []).length}`,
    ];
  },

  css: `
svg.arr { display: inline-block; width: 0.95em; height: 0.68em; vertical-align: 0.02em; overflow: visible; }
.cyc__arr svg.arr, .path__arr svg.arr, .cyc__up svg.arr, .cyc__down svg.arr { width: 1.2em; height: 0.86em; }
/* page 2 holds a longer intro and 13 contents lines: the contents in two columns */
.toc { margin-top: 7mm; }
.toc__h { font-size: 16pt; }
.intro .toc ol { margin-top: 3mm; display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, auto); grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 8mm; border-top: none; }
.toc li { break-inside: avoid; border-top: var(--hair); border-bottom: none; }
.toc a { padding: 1.1mm 0; gap: 4mm; }
.intro > p:first-child { font-size: 12.5pt; }
/* figures: one right edge with the h2 rules, rows and template boxes (160 mm, set in .fig below) */
.guide .fig p, .guide .fig ul, .guide .fig ol, .guide .fig table { max-width: none; }
.guide .fig .fig__cap { max-width: 150mm; text-wrap: pretty; }
.fig--untitled .bar:first-child, .fig--untitled .ftable tr:first-child td { border-top: var(--line); }
.row__t .fig { margin: 3mm 0 1mm; max-width: none; }
.guide .row:has(> .row__t > .fig) { break-inside: auto; }
/* blocks that must not break inside */
.guide .tagged, .guide ul.keep, .guide ol.keep, .guide ul > li { break-inside: avoid; }
.guide p:has(+ pre.tpl) { break-after: avoid; }
.guide .row--last { break-before: avoid; }
/* glossary: the bold term is the only marker */
.guide ul.gloss > li { padding-left: 4mm; text-indent: -4mm; }
.guide ul.gloss > li::before { content: none; }
/* numbers of ordered lists on the text baseline */
.guide ol > li::before, .intro ol > li::before { top: 0.42em; }
/* inline slots and literal names */
code.slot { white-space: nowrap; }
.links { display: grid; grid-template-columns: 6mm minmax(0, 1fr); row-gap: 0.3mm; margin-top: 1mm; }
.links__l { font-family: var(--font-mono); font-size: 7.5pt; line-height: 1.6; color: var(--muted); }
a.ref { text-decoration: none; }
/* arrows next to bold text: a heavier stroke, even spacing */
svg.arr { margin: 0 0.05em; }
strong svg.arr path, h3 svg.arr path, h4 svg.arr path, .fig__title svg.arr path, .cyc__name svg.arr path { stroke-width: 1.6; }
.cover__title--long { font-size: 38pt; line-height: 1; max-width: 160mm; }
.cover__stages .stage__text { margin-top: 2mm; }

/* headings of the guide's own kinds */
.guide h4 { font-weight: var(--bold); font-size: 11pt; line-height: 1.25; margin-top: 7mm; max-width: 150mm; break-after: avoid; text-wrap: balance; }
.guide h3 + h4 { margin-top: 3mm; }
.guide h4 + * { margin-top: 2.5mm; }
.guide h4.step { display: grid; grid-template-columns: 9mm minmax(0, 1fr); align-items: baseline; }
.tagged .tag { display: block; font-family: var(--font-mono); font-weight: var(--regular); font-size: 8pt; line-height: 1.4; color: var(--muted); letter-spacing: 0; margin-bottom: 0.6mm; }

/* labelled rows */
.row { display: grid; grid-template-columns: 30mm minmax(0, 1fr); column-gap: 4mm; align-items: baseline; max-width: 160mm; break-inside: avoid; }
.guide .row + .row { margin-top: 2mm; }
.row__l { font-family: var(--font-mono); font-size: 7.5pt; line-height: 1.5; color: var(--muted); }
.row__t > * + * { margin-top: 1.6mm; }
.row__t p, .row__t ul, .row__t ol { max-width: none; }

code { font-family: var(--font-mono); font-size: 0.86em; }
pre.tpl {
  border: var(--line);
  padding: 3mm 3.5mm;
  max-width: 160mm;
  font-family: var(--font-mono);
  font-size: 8.25pt;
  line-height: 1.5;
  white-space: pre-wrap;
  break-inside: avoid;
}
pre.tpl code { font-size: inherit; }

/* figures */
.fig { margin: 6mm 0 2mm; max-width: 160mm; break-inside: avoid; }
.guide .fig + * { margin-top: 5mm; }
.fig__title { font-weight: var(--bold); font-size: 10.5pt; line-height: 1.3; border-top: var(--line); padding-top: 2mm; margin-bottom: 3mm; }
.fig__cap { margin-top: 3mm; font-size: 8.5pt; line-height: 1.4; color: var(--muted); max-width: 140mm; }

.tiles { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4mm 5mm; }
.tile { padding: 0; margin: 0 !important; border-top: var(--hair); padding-top: 2mm; }
.tile::before { content: none !important; }
.tile__v { font-family: var(--font-mono); font-size: 20pt; line-height: 1.05; letter-spacing: -0.02em; }
.tile__l { margin-top: 1.2mm; font-size: 8.5pt; line-height: 1.35; color: var(--muted); }

.bars { list-style: none; border-bottom: var(--hair); }
.bar { display: grid; grid-template-columns: 42mm minmax(0, 1fr); column-gap: 4mm; align-items: center; padding: 1.4mm 0 !important; border-top: var(--hair); margin: 0 !important; }
.bar::before { content: none !important; }
.bar__label { font-size: 9pt; line-height: 1.3; }
.bar__track { display: flex; align-items: center; gap: 0; min-height: 4.2mm; }
.bar__fill { display: block; height: 3.2mm; background: var(--ink); flex: none; }
.bar__range { display: block; height: 3.2mm; flex: none; min-width: 3mm; box-shadow: inset 0 0 0 0.25mm var(--ink); background: repeating-linear-gradient(135deg, var(--ink) 0 0.35mm, transparent 0.35mm 1.1mm); }
.bar__v { margin-left: 2mm; font-family: var(--font-mono); font-size: 8pt; white-space: nowrap; }
.bar__note { grid-column: 2; margin-top: 0.6mm; font-size: 8pt; line-height: 1.35; color: var(--muted); }
.bars--notes .bar { align-items: start; }
.bars--notes .bar__label { padding-top: 0.2mm; }

.cyc { display: grid; grid-template-columns: minmax(0, 1fr) 7mm minmax(0, 1fr) 7mm minmax(0, 1fr); row-gap: 1.5mm; align-items: stretch; }
.cyc__box { border-top: var(--line); padding-top: 1.6mm; }
.cyc__n { font-family: var(--font-mono); font-size: 8pt; color: var(--muted); }
.cyc__name { font-weight: var(--bold); font-size: 9.5pt; line-height: 1.25; }
.cyc__t { margin-top: 0.8mm; font-size: 8.5pt; line-height: 1.35; color: var(--muted); }
.cyc__arr, .cyc__up, .cyc__down { font-family: var(--font-mono); font-size: 11pt; text-align: center; align-self: center; }
.cyc__up { justify-self: start; padding-left: 2mm; }
.cyc__down { justify-self: end; padding-right: 2mm; }
.cyc__back { margin-top: 2.5mm; font-family: var(--font-mono); font-size: 8pt; }

.lad { list-style: none; border-bottom: var(--hair); display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); align-items: end; column-gap: 1.5mm; }
.lad__step { min-height: var(--h); border-top: var(--line); border-left: var(--hair); padding: 1.6mm 0 1.6mm 2mm !important; margin: 0 !important; }
.lad__step::before { content: none !important; }
.lad__n { font-family: var(--font-mono); font-size: 8pt; color: var(--muted); }
.lad__name { font-weight: var(--bold); font-size: 9pt; line-height: 1.25; }
.lad__t { margin-top: 0.8mm; font-size: 8.5pt; line-height: 1.35; color: var(--muted); }

.path--row { display: grid; align-items: stretch; column-gap: 1.5mm; }
.path__box { border-top: var(--line); padding-top: 1.6mm; }
.path__n { font-family: var(--font-mono); font-size: 8pt; color: var(--muted); }
.path__name { font-weight: var(--bold); font-size: 9.5pt; line-height: 1.25; }
.path__t { margin-top: 0.8mm; font-size: 8.5pt; line-height: 1.35; color: var(--muted); }
.path__arr { font-family: var(--font-mono); font-size: 11pt; align-self: center; text-align: center; }
.vpath { list-style: none; border-left: var(--line); margin-left: 2mm; }
.vpath__i { display: grid; grid-template-columns: 8mm minmax(0, 1fr); padding: 1mm 0 1mm 3mm !important; margin: 0 !important; }
.vpath__i::before { content: none !important; }
.vpath__n { font-family: var(--font-mono); font-size: 8pt; color: var(--muted); padding-top: 0.4mm; }
.vpath__t { font-size: 9.5pt; line-height: 1.35; }

.ftable { width: 100%; border-collapse: collapse; font-size: 9pt; line-height: 1.35; }
.ftable td { border-top: var(--hair); padding: 1.6mm 3mm 1.6mm 0; vertical-align: top; }
.ftable tr:last-child td { border-bottom: var(--hair); }
.ftable__k { width: 42mm; font-weight: var(--bold); }
`,
};
