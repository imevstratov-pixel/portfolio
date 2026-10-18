// «Как разработать онлайн-курс»: the first free guide (decision 18 of 14.10).
// The cover shows the three stages with the number of steps of each, counted
// from the draft; the h3 steps of «Предпродакшн» get their number in small
// mono, as the numbered lists on the site.
import { plural, section } from './engine.mjs';

const STEP = ['шаг', 'шага', 'шагов'];
const stepsWord = (n) => plural(n, STEP);

const STAGES = [
  { name: 'Предпродакшн', text: 'исследование, программа и логика обучения' },
  { name: 'Продакшн', text: 'тексты, видео, задания' },
  { name: 'Постпродакшн', text: 'метрики, интервью с учениками и правки' },
];
// All steps of the three stages. The site says «21 шаг» (pages home,
// services and free in the content): when the draft gets another number of
// steps the build stops, so the site texts and this number change together.
const TOTAL_STEPS = 21;

/** Items of the first numbered list of a section (before its first h3). */
function firstListItems(text) {
  let n = 0;
  for (const line of text.split(/^### /m)[0].split('\n')) {
    if (/^\d+\.\s/.test(line)) n++;
    else if (n && line.trim() !== '' && !/^\s/.test(line)) break; // the list ended
  }
  return n;
}

export default {
  slug: 'kak-razrabotat-onlajn-kurs',
  utm: 'utm_source=guide-pdf&utm_medium=pdf',
  author: 'Даниил Евстратов',
  role: 'методолог образовательных продуктов',
  // parts that start on a new page (h2 texts, start of the heading)
  pageBreakBefore: ['Из каких этапов', 'Предпродакшн', 'Четыре идеи', 'Что почитать'],

  // Steps per stage, counted from the draft: the numbered h3 steps of
  // «## Предпродакшн…», the items of the first numbered list of «## Продакшн…»
  // and of «## Постпродакшн…» (before their first h3).
  check(md, problems) {
    const steps = STAGES.map((st) => {
      const text = section(md, st.name);
      if (text === null) {
        problems.push(`no section «## ${st.name}…» to count its steps`);
        return 0;
      }
      return st.name === 'Предпродакшн' ? (text.match(/^### \d+\.\s/gm) ?? []).length : firstListItems(text);
    });
    steps.forEach((n, i) => {
      if (!n) problems.push(`no steps found in «${STAGES[i].name}»`);
    });
    const counted = steps.reduce((a, b) => a + b, 0);
    if (counted !== TOTAL_STEPS) {
      problems.push(
        `the draft has ${counted} steps (${steps.join(' + ')}), the site says ${TOTAL_STEPS}: ` +
          `fix «${TOTAL_STEPS} шаг» in pages home, services and free, then TOTAL_STEPS in tools/guide-pdf/course.mjs`,
      );
    }
    return { counted, stages: STAGES.map((st, i) => ({ ...st, value: String(steps[i]), unit: stepsWord(steps[i]) })) };
  },

  // the step number of an h3 («1. Изучите…») in small mono
  transform(html) {
    return html.replace(
      /<h3>(\d+)\.\s+([\s\S]*?)<\/h3>/g,
      (_, n, inner) => `<h3 class="step" id="step-${n}"><span class="step__n">${n}</span><span class="step__t">${inner}</span></h3>`,
    );
  },

  cover(ctx, h) {
    const stages = ctx.stages
      .map(
        (s) =>
          `<li><p class="stage__v"><span class="stage__n">${s.value}</span> <span class="stage__u">${s.unit}</span></p><p class="stage__name">${s.name}</p><p class="stage__text">${h.typeset(s.text)}</p></li>`,
      )
      .join('\n');
    return `  <p class="cover__label">Бесплатное руководство</p>
  <div class="cover__main">
    <h1 class="cover__title">${h.escapeHtml(h.typeset(h.title))}</h1>
    <p class="cover__for">${h.escapeHtml(h.typeset('Для онлайн-школ, EdTech-команд, корпоративных академий, основателей и начинающих методистов'))}</p>
  </div>
  <ol class="cover__stages" role="list">${stages}</ol>
  <div class="cover__foot">
    <p><strong>${this.author}</strong><br>${this.role}</p>
    <p class="cover__site"><a href="${h.escapeHtml(h.siteHref)}">${h.siteLabel}</a></p>
  </div>`;
  },

  meta() {
    return {
      Title: 'Как разработать онлайн-курс',
      Author: 'Даниил Евстратов',
      Subject: `Руководство: ${TOTAL_STEPS} ${stepsWord(TOTAL_STEPS)} разработки онлайн-курса, от разбора конкурентов до первых метрик после запуска`,
      Keywords: 'онлайн-курс, разработка курса, методология, методист, EdTech, карта навыков, LX, CustDev',
    };
  },

  report(ctx) {
    return [`steps: ${ctx.stages.map((st) => `${st.name} ${st.value}`).join(', ')}, ${ctx.counted} in all`];
  },

  css: `
table.cols-3 td:first-child { width: 22%; font-weight: var(--bold); }
table.cols-5 td:first-child { width: 36%; }
`,
};
