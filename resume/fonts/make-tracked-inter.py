#!/usr/bin/env python3
"""Derive "tracked" Inter subsets used by resume/resume-ru.html.

Why: the résumé sets its uppercase labels (kicker, section labels, footer) with
wide tracking. Done with CSS letter-spacing, Chromium writes a gap between every
glyph, and PDF text extractors used by ATS (pdfminer, PDFBox, ...) then read
"О П Ы Т  Р А Б О Т Ы". Baking the tracking into the glyph advance widths gives
the same picture, but the glyphs touch in the PDF text layer, so words survive.

Output (next to this script), from the vendored Inter subsets (SIL OFL 1.1):
  inter-tracked20-{latin,cyrillic}-600.woff2   advance += 0.20 em  (kicker, labels)
  inter-tracked15-{latin,cyrillic}-400.woff2   advance += 0.154 em (running footer)

Usage:  python3 -m pip install fonttools brotli && python3 resume/fonts/make-tracked-inter.py
"""
import os

from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = [
    # (tag, extra tracking in em, source weight)
    ("tracked20", 0.20, 600),
    ("tracked15", 0.154, 400),
]
SUBSETS = ["latin", "cyrillic"]
WEIGHT_NAME = {400: "Regular", 600: "SemiBold"}


def track(src, dst, em, family, weight):
    font = TTFont(src)
    upm = font["head"].unitsPerEm
    extra = round(em * upm)
    hmtx = font["hmtx"]
    for glyph, (adv, lsb) in list(hmtx.metrics.items()):
        if adv > 0:  # leave zero-width marks alone
            hmtx.metrics[glyph] = (adv + extra, lsb)
    font["hhea"].advanceWidthMax = max(adv for adv, _ in hmtx.metrics.values())
    style = WEIGHT_NAME[weight]
    ps = f"{family.replace(' ', '')}-{style}"
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = f"{family} {style}"
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 3:
            rec.string = f"{ps};derived"
    font.flavor = "woff2"
    font.save(dst)
    print(f"{os.path.basename(dst)}: +{extra}/{upm} units")


for tag, em, weight in JOBS:
    family = "Inter " + tag.capitalize()
    for subset in SUBSETS:
        track(
            os.path.join(HERE, f"inter-{subset}-{weight}-normal.woff2"),
            os.path.join(HERE, f"inter-{tag}-{subset}-{weight}.woff2"),
            em, family, weight,
        )
