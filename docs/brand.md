# Brand guidelines (v1, 2026-09-20)

Adopted from the exploration in `brand/build.mjs`; regenerate assets with
`FINAL=1 node brand/build.mjs`. Final files live in `brand/final/`.

## Mark — the three-card stack

Three offset cards — ink at the back, vermilion in the middle, a paper card in
front carrying an envelope. It reads as the system "duplicate" icon, which is
the point: your paper, copied and kept. The envelope says mail; the stack says
archive. No magnifier, no cloud, no search bar: the wordmark carries the rest.

| Use | File |
|---|---|
| On light backgrounds | `brand/final/mark.svg` |
| On dark backgrounds | `brand/final/mark-dark.svg` |
| Single colour (print, stamps, embossing) | `brand/final/mark-mono.svg` |
| Inline in HTML, ink follows `currentColor` | `brand/final/mark-inline.svg` |
| Favicon (any size, transparent) | `brand/final/favicon.svg` → `public/icons/favicon.svg` |
| App icon, OS applies the mask | `brand/final/icon-square.svg` → `public/icons/*.png` |
| App icon, pre-rounded (marketing) | `brand/final/icon-rounded.svg` |

Rules: never rotate, recolour, add effects, or separate the envelope from the
stack. Minimum size 16 px (the stack silhouette survives; the envelope is
legible from 24 px). Keep clear space of one card-width around it.

## Wordmark and lockups

"Paper Archive" in IBM Plex Sans JP 600, tracking −1.5%, with
「ペーパーアーカイブ」beneath in 500 at ~45% size and 72% opacity.
`brand/final/lockup.svg` (light) and `lockup-dark.svg`. The mark sits left, one
card-width from the type. Do not set the wordmark in another face, and do not
translate the Latin — the katakana is the Japanese form.

## Palette

| Role | Hex | Use |
|---|---|---|
| Ink navy | `#1e2a44` | mark, wordmark, app icon background, theme colour |
| Hanko vermilion | `#e34234` | the single accent: middle card, cursor, highlights |
| Paper | `#f6f3ee` | light surfaces, the front card |
| Dark surface | `#0f1526` | dark-mode surfaces |
| White | `#ffffff` | ink on dark |

Vermilion is an accent, never a fill for large areas and never a text colour on
light surfaces. Status colours in the UI (warning amber, danger red) are
separate and are not brand colours.

## Typeface

**IBM Plex Sans JP** for brand and headings — its Latin and Japanese were
designed together, so bilingual lockups sit at one weight and rhythm. Body text
in the app stays on the system font (Hiragino Sans on iOS, Noto Sans JP on
Android): it is what users read fastest, and Japanese webfonts are heavy. The
app loads Plex only as a subset for the wordmark.

Fallback stack: `'IBM Plex Sans JP', 'Hiragino Sans', 'Noto Sans JP', -apple-system, sans-serif`.

## Icons

**Lucide** (ISC, https://lucide.dev), 2 px stroke, `currentColor`. Only the icons
in use are vendored, as inline SVG in `public/icons.js`; add more by extending the
name list in the generator step recorded in `public/vendor/README.txt`. No emoji in
the interface; the retention glyphs ◎ ◍ ◑ ⚠ are typographic and stay.

## Copy (editor-reviewed, adopted 2026-09-20)

Headline: **撮る。わかる。手放せる。** / **Scan it. Know it. Let it go.**
Supporting: **いつ何をするかわかる。捨てても探せる。** / **Know what's due. Find it after it's gone.**

Why it works (editor's note): a three-beat run of verbs reads as a timeline in
Japanese — action → result → release — as long as each verb can silently take 紙 as
its object. 忘れる could not (rejected); わかる and 手放せる can. The supporting line
says what わかる contains and why 手放せる is safe. No personification, no value words
stated outright (安心, 簡単), no 捨てる in the headline (some originals must be kept;
捨てても探せる is honest because it is conditional).

Typography: full-width 「。」「、」, a 。 after the last beat too, no space after
punctuation; wrap only after punctuation (`word-break: keep-all`); ひらがな for
わかる／やること／捨てていいか; no 「！」「…」「〜」. English in sentence case, no
exclamation marks. Retired: the pipeline arrows, 「撮る。忘れる。見つかる。」,
「届いた紙が、自分で説明してくれる。」.

## Voice (short)

Plain, bilingual, unhurried. English and Japanese are peers, not translations of
each other. Advice about keeping originals is conservative and says "unsure"
when it is unsure.

## Not yet applied

The app's interactive accent (buttons, links, active tab) is still the earlier
blue. Restyling it to navy/vermilion is a deliberate follow-up, to be checked in
both themes, not part of the logo change.
