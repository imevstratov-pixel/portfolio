// Print-specific presentation for the methodology guide. All words and
// framework data come from the same exported JSON as the interactive page.
export function frameworkConfig(guide, images) {
  return {
    slug: guide.slug,
    utm: 'utm_source=framework-guide&utm_medium=pdf',
    author: guide.author,
    role: 'методолог образовательных продуктов',
    pageBreakBefore: [guide.intro.title, guide.tierTitle, guide.stacksTitle, guide.frameworksTitle, guide.sequence.title, guide.worksheet.title],
    check(md, problems) {
      const cards = (md.match(/^### [SABCD] · /gm) ?? []).length;
      if (!cards) problems.push('no framework cards in the compiled guide');
      if (!guide.sources?.length) problems.push('no sources in the exported guide');
      if ((md.match(/^STACK_RECOMMENDATION_START$/gm) ?? []).length !== guide.stacks.length) problems.push('missing recommended stacks');
      if ((md.match(/^SERVICE_OFFER_START_/gm) ?? []).length !== 3) problems.push('expected three service offers');
      return { cards, stacks: guide.stacks?.length ?? 7 };
    },
    transform(html, h) {
      const labels = ['Как применить', 'Что даёт', 'Где не поможет', 'Что получится', 'Первоисточник', 'Чему учим', 'Как собрать', 'Как проверить результат', 'Где этой сборки мало', 'Подходы в сборке', 'Пример', 'Ситуация', 'Первый шаг'];
      html = html.replace(/<p>STACK_RECOMMENDATION_START<\/p>([\s\S]*?)<p>STACK_RECOMMENDATION_END<\/p>/g,
        '<section class="stack-recommendation">$1</section>');
      html = html.replace(/<p>SERVICE_OFFER_START_(consulting|audit|build)<\/p>([\s\S]*?)<p>SERVICE_OFFER_END<\/p>/g,
        '<aside class="service-offer service-offer--$1">$2</aside>');
      html = html.replace(/<h3>([SABCD]) · ([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23](?: |>)|$)/g,
        (_, tier, title, body) => `<section class="framework-card"><h3 class="framework-title"><span class="tier-tag">${tier}</span><span>${title}</span></h3>${body}</section>`);
      html = html.replace(/<h3>(\d+)\. ([\s\S]*?)<\/h3>/g,
        (_, n, title) => `<h3 class="stack-title"><span class="stack-number">${n.padStart(2, '0')}</span>${title}</h3>`);
      html = html.replace(/<p><strong>([^<]+?)[.:]<\/strong>\s*([\s\S]*?)<\/p>/g, (whole, label, body) =>
        labels.includes(label) ? `<div class="detail-row"><p class="detail-label">${label}</p><div><p>${body}</p></div></div>` : whole);
      html = html.replace(/<pre><code(?: class="language-[^"]*")?>([\s\S]*?)<\/code><\/pre>/g,
        (_, body) => `<pre class="ascii-diagram">${body}</pre>`);
      html = html.replace(/<p>ILLUSTRATION_PRACTICE<\/p>/g,
        `<figure class="print-illustration"><img src="${images.practice}" alt="${h.escapeHtml(guide.practiceImage.alt)}"><figcaption>${h.escapeHtml(guide.practiceImage.caption)}</figcaption></figure>`);
      html = html.replace(/<p>WORKSHEET_LINE<\/p>/g, '<div class="worksheet-lines"><span></span><span></span></div>');
      html = html.replace(/(<h3 class="stack-title">(?:(?!<\/h3>)[\s\S])*<\/h3>)\s*(<p>Например:(?:(?!<\/p>)[\s\S])*<\/p>)\s*(<div class="worksheet-lines">[\s\S]*?<\/div>)/g,
        '<section class="worksheet-field">$1$2$3</section>');
      html = html.replace(/<p><strong>(<a href=[\s\S]*?)<\/strong> — ([\s\S]*?)<\/p>/g,
        '<p class="source-entry"><strong>$1</strong> — $2</p>');
      // Inter Tight's Cyrillic/Latin subsets do not contain arrow glyphs.
      html = html.replace(/(^|>)([^<]+)(?=<|$)/g, (_, start, text) => start + text.replace(/→/g,
        '<svg class="inline-arrow" viewBox="0 0 14 10" aria-label="затем"><path d="M1 5h11M8.5 1.5L12 5 8.5 8.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'));
      return html;
    },
    cover(ctx, h) {
      return `<p class="cover__label">${h.escapeHtml(guide.label)} / Методология</p>
<div class="cover__main"><h1 class="cover__title">${h.escapeHtml(guide.title)}</h1><p class="cover__for">${h.escapeHtml(guide.subtitle)}</p></div>
<figure class="cover-art"><img src="${images.hero}" alt="${h.escapeHtml(guide.heroImage.alt)}"></figure>
<div class="cover-overview"><div><p class="cover-overview__n">S / A / B / C / D</p><p>приоритеты для первого продукта</p></div><div><p class="cover-overview__n">${ctx.stacks} сборок</p><p>курс, бот, гайд, приложение</p></div><div><p class="cover-overview__n">${guide.worksheet.fields.length} ${h.plural(guide.worksheet.fields.length, ['вопрос', 'вопроса', 'вопросов'])}</p><p>чтобы собрать свою основу</p></div></div>
<div class="cover__foot"><p><strong>${h.escapeHtml(this.author)}</strong><br>${this.role}</p><p class="cover__site"><a href="${h.escapeHtml(h.siteHref)}">${h.siteLabel}</a></p></div>`;
    },
    meta() {
      return { Title: guide.title, Author: guide.author, Subject: guide.description, Keywords: 'методология, онлайн-образование, тир-лист, фреймворки, проектирование обучения, образовательный продукт' };
    },
    report(ctx) { return [`framework cards: ${ctx.cards}; product stacks: ${ctx.stacks}`]; },
    css: `
.cover__main { margin-top: 18mm; }
.cover__title { font-size: 44pt; line-height: .99; max-width: 165mm; }
.cover__for { margin-top: 7mm; max-width: 155mm; font-size: 15pt; }
.cover-art { margin-top: 8mm; width: 170mm; height: 85mm; }
.cover-art img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.cover-overview { margin-top: auto; display: grid; grid-template-columns: 1.45fr 1fr 1fr; gap: 6mm; }
.cover-overview > div { border-top: var(--line); padding-top: 3mm; }
.cover-overview__n { font: 400 12pt/1.3 var(--font-mono); margin-bottom: 2mm; }
.cover-overview > div > p:last-child { font-size: 9pt; line-height: 1.35; }
.cover__foot { margin-top: 10mm; }
.intro > p:first-child { font-size: 13pt; }
.toc { margin-top: 8mm; }
.intro .toc a { padding: 2mm 0; }
.guide { font-size: 10pt; line-height: 1.43; }
.guide h3 { margin-top: 6mm; }
.framework-card { break-inside: avoid; margin-top: 5mm; padding-top: 4mm; border-top: var(--hair); }
.framework-card h3.framework-title { display: flex; gap: 4mm; align-items: baseline; margin: 0 0 3mm; max-width: none; font-size: 14pt; }
.tier-tag { display: inline-block; font: 400 12pt/1 var(--font-mono); width: 7mm; flex: 0 0 7mm; }
.framework-card > p, .framework-card > div { margin-top: 2mm; }
.framework-card > p:first-of-type { font-size: 8pt; font-family: var(--font-mono); color: var(--muted); }
.detail-row { display: grid; grid-template-columns: 34mm minmax(0, 1fr); gap: 4mm; break-inside: avoid; }
.detail-label { font: 400 7.5pt/1.5 var(--font-mono); color: var(--muted); padding-top: .4mm; }
.detail-row > div > p { max-width: none; }
.framework-card .detail-row { font-size: 9.25pt; line-height: 1.4; }
.guide .stack-title { display: flex; gap: 4mm; font-size: 15pt; margin-top: 8mm; }
.stack-number { font: 400 9pt/1.6 var(--font-mono); color: var(--muted); }
.stack-recommendation { max-width: 150mm; border-top: var(--hair); border-bottom: var(--hair); padding: 3mm 0; break-inside: avoid; font-size: 9.25pt; line-height: 1.4; }
.stack-recommendation h4 { font: 400 8pt/1.4 var(--font-mono); color: var(--muted); margin: 0 0 2mm; }
.stack-recommendation p { margin-bottom: 2mm; }
.stack-recommendation ul > li { padding-left: 0; }
.stack-recommendation ul > li::before { content: none; }
.stack-recommendation ul > li + li { margin-top: 1.3mm; }
.stack-recommendation ul + h4 { margin-top: 3mm; }
.service-offer { max-width: 150mm; border-top: var(--line); padding-top: 4mm; margin: 6mm 0 0; break-inside: avoid; }
.guide .service-offer h3 { margin-top: 0; font-size: 14pt; line-height: 1.2; }
.service-offer > p { margin-top: 2.5mm; }
.service-offer > p:last-child { font-size: 9pt; }
.ascii-diagram { border-top: var(--hair); border-bottom: var(--hair); padding: 4mm 0; margin: 5mm 0; font: 400 8.3pt/1.5 var(--font-mono); white-space: pre-wrap; break-inside: avoid; }
.inline-arrow { width: 1em; height: .72em; vertical-align: -.02em; display: inline-block; }
.print-illustration { width: 150mm; margin: 5mm 0; break-inside: avoid; }
.print-illustration img { width: 100%; display: block; image-rendering: pixelated; }
.print-illustration figcaption { font: 400 8pt/1.5 var(--font-mono); color: var(--muted); margin-top: 2mm; }
.worksheet-field { break-inside: avoid; margin-top: 4mm; }
.worksheet-field h3.stack-title { margin-top: 0; font-size: 11.25pt; }
.worksheet-field > p { font-size: 9pt; line-height: 1.35; margin-top: 2mm; }
.worksheet-lines { margin-top: 2mm; break-inside: avoid; }
.worksheet-lines span { display: block; height: 5.8mm; border-bottom: var(--hair); }
.guide .source-entry { break-inside: avoid; font-size: 9.25pt; line-height: 1.4; margin-top: 3mm; }
table { font-size: 8.5pt; }
table.cols-3 td:first-child { width: 8mm; font-family: var(--font-mono); }
table.cols-3 td:nth-child(2) { width: 32mm; }
.guide > h2 { max-width: 165mm; }
.guide a.url { white-space: normal; overflow-wrap: anywhere; }
`,
  };
}
