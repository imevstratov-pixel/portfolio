#!/usr/bin/env bash
# Internal-notes check over the built site (quality bar of the brief).
#
#   npm run build && npm run leakcheck            # checks dist/
#   bash tools/leakcheck.sh path/to/dist
#
# Then it runs tools/prodcheck.mjs on the same dist/: the deploy-mode check
# (preview: no Metrika, noindex everywhere, robots.txt disallows, no sitemap;
# production: Metrika on every page, no noindex, robots.txt allows, sitemap
# lists every page; both: old URLs and old home anchors keep working).
#
# Fails on files under dist/media/ that no generated page references.
#
# Greps dist/ for: _note _todo _draft hidden «МЕСТО ДЛЯ» seller-ai-course
# studio-expert university-curator.
# - Everything the build generates (Astro pages, _astro/ assets, work.html,
#   404.html) must contain none of them. The one exception is the ARIA
#   attribute aria-hidden (a mouse-only duplicate link, e.g. the cover of the
#   free guide): "hidden" right after "aria-" is not a content marker.
# - Files copied verbatim from the old site (assets/, resume/, demo/, en/,
#   styles.css, script.js, game.js, products/*.jpg) must contain none of the content
#   markers; in them "hidden" and "_note" also occur as ordinary CSS/HTML
#   (overflow:hidden, aria-hidden, .lightbox__note), so those two are listed
#   for review but do not fail the check. Pass --strict to fail on them too.
set -euo pipefail

STRICT=0
DIST=""
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    *) DIST="$arg" ;;
  esac
done
TOOLS="$(cd "$(dirname "$0")" && pwd)"
DIST="${DIST:-$TOOLS/../dist}"
[ -f "$DIST/index.html" ] || { echo "leakcheck: $DIST has no index.html, run npm run build first" >&2; exit 1; }
DIST="$(cd "$DIST" && pwd)"

ALL='_note|_todo|_draft|(?<!aria-)hidden|МЕСТО ДЛЯ|seller-ai-course|studio-expert|university-curator'
CONTENT='_todo|_draft|МЕСТО ДЛЯ|seller-ai-course|studio-expert|university-curator'
SOFT='_note|hidden'
# print each hit as file:line: …context… (minified files have very long lines)
# (Perl regex for the lookbehind in ALL; bytes, so any encoding is fine)
hits() { local pat="$1"; shift; LC_ALL=C grep -I -n -o -P ".{0,40}($pat).{0,40}" -- "$@"; }
# products/ holds the generated /products/ page too: only its two copied
# screenshots are legacy files.
LEGACY=(assets resume demo en styles.css script.js game.js products/top-pick.jpg products/dobei.jpg)

cd "$DIST"
prune=()
for p in "${LEGACY[@]}"; do prune+=(-path "./$p" -prune -o); done
mapfile -t generated < <(find . "${prune[@]}" -type f -print | sort)
legacy=()
for p in "${LEGACY[@]}"; do
  [ -e "$p" ] && mapfile -t -O "${#legacy[@]}" legacy < <(find "./$p" -type f | sort)
done

fail=0
if [ "${#generated[@]}" -gt 0 ] && hits "$ALL" "${generated[@]}"; then
  echo "leakcheck: internal markers found in generated files (above)" >&2
  fail=1
fi
if [ "${#legacy[@]}" -gt 0 ] && hits "$CONTENT" "${legacy[@]}"; then
  echo "leakcheck: content markers found in copied legacy files (above)" >&2
  fail=1
fi
# Every file under media/ (screenshots and videos prepared for this site) must
# be referenced by a generated page. A file nothing links to is most likely one
# that waits for Daniil's OK (status: "hidden" in the content) and must not be
# served: keep such files outside public/ until he approves them.
if [ -d media ]; then
  mapfile -t pages < <(find . "${prune[@]}" -type f -name '*.html' -print | sort)
  unref=()
  while IFS= read -r f; do
    rel="${f#./}"
    grep -q -F -- "$rel" "${pages[@]}" || unref+=("$rel")
  done < <(find ./media -type f | sort)
  if [ "${#unref[@]}" -gt 0 ]; then
    echo "leakcheck: files under media/ that no generated page references (move them out of public/):" >&2
    printf '  %s\n' "${unref[@]}" >&2
    fail=1
  fi
fi
soft=$( [ "${#legacy[@]}" -gt 0 ] && grep -I -l -E "$SOFT" -- "${legacy[@]}" || true )
if [ -n "$soft" ]; then
  if [ "$STRICT" = 1 ]; then
    echo "leakcheck (--strict): \"hidden\" or \"_note\" in legacy files:" >&2
    # shellcheck disable=SC2086
    hits "$SOFT" $soft >&2
    fail=1
  else
    echo "leakcheck: note, \"hidden\"/\"_note\" occur in $(echo "$soft" | wc -l) legacy file(s) copied from the old site (CSS/HTML usage; review with --strict):"
    echo "$soft" | sed 's/^/  /'
  fi
fi

echo "leakcheck: ${#generated[@]} generated files, ${#legacy[@]} legacy files checked"
if [ "$fail" = 1 ]; then exit 1; fi
echo "OK: no internal notes in dist/"

# deploy mode (PREVIEW, BASE, SITE from the environment, as for the build)
exec node "$TOOLS/prodcheck.mjs" "$DIST"
