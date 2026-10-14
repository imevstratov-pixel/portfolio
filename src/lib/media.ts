// Build-time helpers for files in public/: existence and intrinsic image size.
// Sizes go into width/height attributes so the browser reserves space before
// the image loads (no layout shift), next to the CSS aspect-ratio box.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_DIR = resolve(process.cwd(), 'public');

/** Absolute file path for a site path like "/products/dobei.jpg" or "assets/og.jpg". */
export function publicPath(sitePath: string): string {
  return resolve(PUBLIC_DIR, sitePath.replace(/[?#].*$/, '').replace(/^\.?\/+/, ''));
}

export function publicFileExists(sitePath: string): boolean {
  return !!sitePath && existsSync(publicPath(sitePath));
}

export type Size = { width: number; height: number };
const cache = new Map<string, Size | null>();

/** Width and height of a JPEG, PNG, GIF or WebP in public/, or null if unknown. */
export function imageSize(sitePath: string): Size | null {
  if (!sitePath) return null;
  if (cache.has(sitePath)) return cache.get(sitePath)!;
  let size: Size | null = null;
  try {
    size = parse(readFileSync(publicPath(sitePath)));
  } catch {
    size = null;
  }
  cache.set(sitePath, size);
  return size;
}

function parse(b: Buffer): Size | null {
  // PNG
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // GIF
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WebP (VP8 / VP8L / VP8X)
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const n = b.readUInt32LE(21);
      return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  // JPEG: walk the segments to the first SOFn marker
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ------------------------------------------------------- downloadable files */

/** Size in bytes of a file in public/ (throws when it is missing). */
export function fileSize(sitePath: string): number {
  return statSync(publicPath(sitePath)).size;
}

/** «244 КБ», «1,2 МБ» (1 КБ = 1024 bytes; a non-breaking space before the unit). */
export function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))}\u00a0КБ`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')}\u00a0МБ`;
}

/**
 * Number of pages of a PDF in public/, read from its page tree
 * (`/Type /Pages … /Count N`), or null when the file keeps it in a compressed
 * object stream. Used on /free/ to check the «PDF, N страниц» line.
 */
export function pdfPageCount(sitePath: string): number | null {
  const text = readFileSync(publicPath(sitePath)).toString('latin1');
  let max = 0;
  for (const m of text.matchAll(/<<((?:(?!<<|>>)[\s\S])*?\/Type\s*\/Pages\b(?:(?!<<|>>)[\s\S])*?)>>/g)) {
    const n = Number(m[1].match(/\/Count\s+(\d+)/)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max || null;
}
