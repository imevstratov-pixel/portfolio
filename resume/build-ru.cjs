#!/usr/bin/env node
// Builds assets/daniil-evstratov-resume-ru.pdf from resume/resume-ru.html.
//
//   NODE_PATH=/opt/node22/lib/node_modules node resume/build-ru.cjs [out.pdf]
//
// Renders the page with Playwright Chromium (fonts are vendored in resume/fonts/,
// so no network is needed), waits for document.fonts.ready, prints A4 with
// backgrounds, then writes the PDF Info dictionary (Title/Author/...) through a
// small incremental update, because Chromium only sets Title on its own.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, 'resume-ru.html');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'daniil-evstratov-resume-ru.pdf'));
const META = {
  Title: 'Даниил Евстратов — резюме',
  Author: 'Даниил Евстратов',
  Subject: 'Резюме: Senior Learning Experience Designer',
  Keywords: 'Даниил Евстратов, резюме, методист, Learning Experience Designer, LXD, EdTech',
};

// PDF text string as UTF-16BE hex with BOM (safe for Cyrillic and any punctuation).
function pdfString(s) {
  const buf = Buffer.alloc(2 + s.length * 2);
  buf.writeUInt16BE(0xfeff, 0);
  for (let i = 0; i < s.length; i++) buf.writeUInt16BE(s.charCodeAt(i), 2 + i * 2);
  return '<' + buf.toString('hex').toUpperCase() + '>';
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

// Appends a new Info object + xref section + trailer (/Prev → previous xref).
function setInfo(pdf, meta) {
  const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new Error('startxref not found');
  const prevXref = Number(sx[1]);
  const trailerText = pdf.subarray(prevXref).toString('latin1');
  const size = Number((/\/Size\s+(\d+)/.exec(trailerText) || [])[1]);
  const root = (/\/Root\s+(\d+\s+\d+\s+R)/.exec(trailerText) || [])[1];
  if (!size || !root) throw new Error('could not parse trailer (xref stream PDFs are not supported)');
  const oldInfo = (/\/Info\s+(\d+)\s+\d+\s+R/.exec(trailerText) || [])[1];
  let extra = '';
  if (oldInfo) {
    // keep Creator/Producer/CreationDate written by Chromium
    const m = new RegExp(`(?:^|[\\r\\n])${oldInfo}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(pdf.toString('latin1'));
    if (m) {
      for (const key of ['Creator', 'Producer', 'CreationDate']) {
        const km = new RegExp(`/${key}\\s*(\\([^)]*\\)|<[^>]*>)`).exec(m[1]);
        if (km) extra += `/${key} ${km[1]} `;
      }
    }
  }
  const id = size;
  const fields = Object.entries(meta).map(([k, v]) => `/${k} ${pdfString(v)}`).join(' ');
  const obj = `${id} 0 obj\n<< ${fields} ${extra}/ModDate ${pdfDate(new Date())} >>\nendobj\n`;
  const sep = pdf[pdf.length - 1] === 0x0a ? '' : '\n';
  const objOffset = pdf.length + Buffer.byteLength(sep, 'latin1');
  const xrefOffset = objOffset + Buffer.byteLength(obj, 'latin1');
  const xref = `xref\n${id} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size ${id + 1} /Root ${root} /Info ${id} 0 R /Prev ${prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(sep + obj + xref, 'latin1')]);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    });
    const missing = await page.evaluate(() => [400, 600, 700].filter((w) => !document.fonts.check(`${w} 12px Inter`, 'Аа')));
    if (missing.length) throw new Error('Inter weights not loaded: ' + missing.join(', '));
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, setInfo(Buffer.from(pdf), META));
    console.log('wrote ' + OUT);
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
