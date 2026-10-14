#!/usr/bin/env node
// Builds assets/daniil-evstratov-cv.pdf (English CV) from resume/cv-en.html.
//
//   NODE_PATH=/opt/node22/lib/node_modules node resume/build-en.cjs [out.pdf]
//
// Renders the page with Playwright Chromium (Archivo is vendored in resume/fonts/,
// so no network is needed), waits for document.fonts.ready and the portrait, prints
// A4 with backgrounds and a text layer, then writes the PDF Info dictionary
// (Title/Author/...) as a small incremental update, because Chromium sets only Title.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, 'cv-en.html');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'daniil-evstratov-cv.pdf'));
const META = {
  Title: 'Daniil Evstratov — CV',
  Author: 'Daniil Evstratov',
  Subject: 'CV: Senior Learning Experience Designer',
  Keywords: 'Daniil Evstratov, CV, resume, Senior Learning Experience Designer, LXD, instructional design, EdTech',
};

// PDF text string as UTF-16BE hex with BOM (safe for the em dash and any other character).
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

// Appends a new Info object, an xref section and a trailer pointing at the previous xref.
function setInfo(pdf, meta) {
  const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString('latin1');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new Error('startxref not found');
  const prevXref = Number(sx[1]);
  const trailerText = pdf.subarray(prevXref).toString('latin1');
  const size = Number((/\/Size\s+(\d+)/.exec(trailerText) || [])[1]);
  const root = (/\/Root\s+(\d+\s+\d+\s+R)/.exec(trailerText) || [])[1];
  if (!size || !root) throw new Error('could not parse the trailer (xref-stream PDFs are not supported)');
  const oldInfo = (/\/Info\s+(\d+)\s+\d+\s+R/.exec(trailerText) || [])[1];
  let keep = '';
  if (oldInfo) {
    const m = new RegExp(`(?:^|[\\r\\n])${oldInfo}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(pdf.toString('latin1'));
    if (m) {
      for (const key of ['Creator', 'Producer', 'CreationDate']) {
        const km = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[^>]*>)`).exec(m[1]); // literal strings may hold \( \)
        if (km) keep += `/${key} ${km[1]} `;
      }
    }
  }
  const id = size;
  const fields = Object.entries(meta).map(([k, v]) => `/${k} ${pdfString(v)}`).join(' ');
  const obj = `${id} 0 obj\n<< ${fields} ${keep}/ModDate ${pdfDate(new Date())} >>\nendobj\n`;
  const sep = pdf[pdf.length - 1] === 0x0a ? '' : '\n';
  const objOffset = pdf.length + Buffer.byteLength(sep, 'latin1');
  const xrefOffset = objOffset + Buffer.byteLength(obj, 'latin1');
  const xref = `xref\n${id} 1\n${String(objOffset).padStart(10, '0')} 00000 n \n` +
    `trailer\n<< /Size ${id + 1} /Root ${root} /Info ${id} 0 R /Prev ${prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(sep + obj + xref, 'latin1')]);
}

(async () => {
  // CHROMIUM=/path/to/chrome uses an installed browser instead of Playwright's download
  // (e.g. CHROMIUM=/opt/pw-browsers/chromium when the bundled revision is missing).
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    });
    const missing = await page.evaluate(() => [400, 600, 800].filter((w) => !document.fonts.check(`${w} 13px Archivo`, 'Aa₽')));
    if (missing.length) throw new Error('Archivo weights not loaded: ' + missing.join(', '));
    const pages = await page.evaluate(() => document.querySelectorAll('.page').length);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, setInfo(Buffer.from(pdf), META));
    console.log(`wrote ${OUT} (${pages} pages in source)`);
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
