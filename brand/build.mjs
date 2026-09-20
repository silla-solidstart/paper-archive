/**
 * Logo generator — five directions, one source of geometry.
 *
 *   node brand/build.mjs            → brand/out/<direction>/{mark,mark-dark,mark-mono,icon,lockup,lockup-dark}.svg
 *                                     + brand/out/contact-sheet.html
 *
 * Marks are drawn on a 512×512 grid, single stroke weight, no gradients.
 * Palette: ink navy, hanko vermilion accent, paper off-white.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");

export const PALETTE = { ink: "#1e2a44", accent: "#e34234", paper: "#f6f3ee", white: "#ffffff", dark: "#0f1526" };

// ---------- the five marks (512 grid); c = { ink, accent, bg } ----------

const marks = {
  "1-fold-check": {
    title: "Fold-check",
    blurb: "A sheet whose folded corner is the accent, and a check inside: paper, read, resolved.",
    draw: (c) => `
      <path d="M156 88 H300 L424 212 V400 a24 24 0 0 1 -24 24 H156 a24 24 0 0 1 -24 -24 V112 a24 24 0 0 1 24 -24 Z"
            fill="none" stroke="${c.ink}" stroke-width="28" stroke-linejoin="round"/>
      <path d="M300 88 V188 a24 24 0 0 0 24 24 H424 Z" fill="${c.accent}"/>
      <path d="M208 296 L262 350 L350 246" fill="none" stroke="${c.ink}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "2-hanko": {
    title: "Hanko",
    blurb: "A hairline seal ring — processed, approved — around a page glyph.",
    draw: (c) => `
      <circle cx="256" cy="256" r="200" fill="none" stroke="${c.accent}" stroke-width="22"/>
      <path d="M198 164 H288 L332 208 V348 a16 16 0 0 1 -16 16 H198 a16 16 0 0 1 -16 -16 V180 a16 16 0 0 1 16 -16 Z"
            fill="none" stroke="${c.ink}" stroke-width="22" stroke-linejoin="round"/>
      <path d="M288 164 V192 a16 16 0 0 0 16 16 H332 Z" fill="${c.ink}"/>
      <path d="M220 268 H296 M220 312 H268" fill="none" stroke="${c.ink}" stroke-width="22" stroke-linecap="round"/>`,
  },
  "3-slot": {
    title: "Slot",
    blurb: "An envelope dropping into a slot: scan and forget.",
    draw: (c) => `
      <g transform="rotate(-14 256 224)">
        <rect x="140" y="146" width="232" height="156" rx="20" fill="none" stroke="${c.ink}" stroke-width="26"/>
        <path d="M140 166 L256 254 L372 166" fill="none" stroke="${c.ink}" stroke-width="26" stroke-linejoin="round"/>
      </g>
      <rect x="92" y="364" width="328" height="44" rx="22" fill="${c.accent}"/>`,
  },
  "4-stack": {
    title: "Stack",
    blurb: "Three pages, offset — an archive. The front one is the one you are holding.",
    draw: (c) => `
      <rect x="112" y="196" width="216" height="216" rx="26" fill="${c.ink}"/>
      <rect x="160" y="148" width="216" height="216" rx="26" fill="${c.accent}" stroke="${c.bg}" stroke-width="10"/>
      <rect x="208" y="100" width="216" height="216" rx="26" fill="${c.bg}" stroke="${c.ink}" stroke-width="24"/>`,
  },
  "6a-story-cards": {
    title: "Story stack — cards",
    blurb: "Three offset cards, one glyph each: mail at the bottom, cloud in the middle, search on top. Literal.",
    draw: (c) => `
      <rect x="104" y="204" width="208" height="208" rx="26" fill="${c.ink}"/>
      <g fill="none" stroke="${c.bg}" stroke-width="16" stroke-linejoin="round">
        <rect x="140" y="262" width="136" height="92" rx="12"/>
        <path d="M140 276 L208 326 L276 276"/>
      </g>
      <rect x="152" y="152" width="208" height="208" rx="26" fill="${c.accent}" stroke="${c.bg}" stroke-width="10"/>
      <path d="M204 296 a34 34 0 0 1 4 -68 a48 48 0 0 1 92 -12 a38 38 0 0 1 12 80 Z" fill="none" stroke="${c.bg}" stroke-width="16" stroke-linejoin="round"/>
      <rect x="200" y="100" width="208" height="208" rx="26" fill="${c.bg}" stroke="${c.ink}" stroke-width="24"/>
      <circle cx="292" cy="192" r="40" fill="none" stroke="${c.ink}" stroke-width="20"/>
      <path d="M322 222 L358 258" stroke="${c.ink}" stroke-width="22" stroke-linecap="round"/>`,
  },
  "6b-story-fused": {
    title: "Story stack — fused",
    blurb: "No frames: the envelope, the cloud, and the lens overlap directly, each occluding the one behind.",
    draw: (c) => `
      <rect x="92" y="250" width="240" height="160" rx="22" fill="${c.bg}" stroke="${c.ink}" stroke-width="26"/>
      <path d="M92 274 L212 366 L332 274" fill="none" stroke="${c.ink}" stroke-width="26" stroke-linejoin="round"/>
      <path d="M186 296 a52 52 0 0 1 8 -104 a76 76 0 0 1 148 -18 a60 60 0 0 1 18 122 Z" fill="${c.bg}" stroke="${c.ink}" stroke-width="26" stroke-linejoin="round"/>
      <circle cx="356" cy="132" r="66" fill="${c.bg}" stroke="${c.accent}" stroke-width="26"/>
      <path d="M404 180 L452 228" stroke="${c.accent}" stroke-width="30" stroke-linecap="round"/>`,
  },
  "6c-story-lens": {
    title: "Story stack — lens on cloud",
    blurb: "Two layers plus a handle: envelope below, cloud above; the vermilion ring makes the cloud the lens.",
    draw: (c) => `
      <rect x="112" y="272" width="288" height="152" rx="22" fill="${c.bg}" stroke="${c.ink}" stroke-width="26"/>
      <path d="M112 296 L256 396 L400 296" fill="none" stroke="${c.ink}" stroke-width="26" stroke-linejoin="round"/>
      <path d="M170 300 a56 56 0 0 1 10 -110 a80 80 0 0 1 156 -20 a62 62 0 0 1 22 130 Z" fill="${c.bg}" stroke="${c.ink}" stroke-width="26" stroke-linejoin="round"/>
      <circle cx="296" cy="212" r="78" fill="none" stroke="${c.accent}" stroke-width="24"/>
      <path d="M352 268 L412 328" stroke="${c.accent}" stroke-width="30" stroke-linecap="round"/>`,
  },
  "6d-story-fanned": {
    title: "Story stack — fanned",
    blurb: "The duplicate-icon stack, fanned wider so every card shows its glyph: mail, cloud, search.",
    draw: (c) => `
      <rect x="64" y="248" width="196" height="196" rx="24" fill="${c.ink}"/>
      <g fill="none" stroke="${c.bg}" stroke-width="14" stroke-linejoin="round">
        <rect x="100" y="302" width="124" height="86" rx="10"/>
        <path d="M100 316 L162 362 L224 316"/>
      </g>
      <rect x="158" y="158" width="196" height="196" rx="24" fill="${c.accent}" stroke="${c.bg}" stroke-width="10"/>
      <path d="M208 298 a32 32 0 0 1 4 -64 a46 46 0 0 1 88 -12 a36 36 0 0 1 12 76 Z" fill="none" stroke="${c.bg}" stroke-width="14" stroke-linejoin="round"/>
      <rect x="252" y="68" width="196" height="196" rx="24" fill="${c.bg}" stroke="${c.ink}" stroke-width="22"/>
      <circle cx="342" cy="156" r="38" fill="none" stroke="${c.ink}" stroke-width="18"/>
      <path d="M370 184 L404 218" stroke="${c.ink}" stroke-width="20" stroke-linecap="round"/>`,
  },
  "6e-story-badge": {
    title: "Story stack — badge",
    blurb: "Two cards, mail behind, cloud in front, and the lens as a vermilion badge on the corner — like a system 'search in' icon.",
    draw: (c) => `
      <rect x="96" y="176" width="236" height="236" rx="28" fill="${c.ink}"/>
      <g fill="none" stroke="${c.bg}" stroke-width="16" stroke-linejoin="round">
        <rect x="132" y="246" width="128" height="88" rx="10"/>
        <path d="M132 260 L196 306 L260 260"/>
      </g>
      <rect x="164" y="108" width="236" height="236" rx="28" fill="${c.bg}" stroke="${c.ink}" stroke-width="24"/>
      <path d="M232 268 a40 40 0 0 1 6 -80 a58 58 0 0 1 112 -14 a46 46 0 0 1 14 94 Z" fill="none" stroke="${c.ink}" stroke-width="22" stroke-linejoin="round"/>
      <circle cx="392" cy="336" r="62" fill="${c.bg}" stroke="${c.accent}" stroke-width="24"/>
      <path d="M436 380 L474 418" stroke="${c.accent}" stroke-width="28" stroke-linecap="round"/>`,
  },
  "7a-dup-envelope": {
    title: "Duplicate + envelope (two cards)",
    blurb: "The duplicate icon: a vermilion card behind, a paper card in front carrying the envelope. Plain wordmark.",
    draw: (c) => `
      <rect x="108" y="176" width="236" height="236" rx="28" fill="${c.accent}"/>
      <rect x="168" y="100" width="236" height="236" rx="28" fill="${c.bg}" stroke="${c.ink}" stroke-width="24"/>
      <rect x="210" y="170" width="152" height="104" rx="12" fill="none" stroke="${c.ink}" stroke-width="20"/>
      <path d="M210 188 L286 246 L362 188" fill="none" stroke="${c.ink}" stroke-width="20" stroke-linejoin="round"/>`,
  },
  "7b-stack-envelope": {
    title: "Stack + envelope (three cards)",
    blurb: "Same idea with a third card: ink at the back, vermilion in the middle, the envelope in front. Reads as an archive.",
    draw: (c) => `
      <rect x="92" y="212" width="212" height="212" rx="26" fill="${c.ink}"/>
      <rect x="156" y="152" width="212" height="212" rx="26" fill="${c.accent}" stroke="${c.bg}" stroke-width="10"/>
      <rect x="220" y="92" width="212" height="212" rx="26" fill="${c.bg}" stroke="${c.ink}" stroke-width="24"/>
      <rect x="258" y="154" width="136" height="94" rx="12" fill="none" stroke="${c.ink}" stroke-width="18"/>
      <path d="M258 170 L326 222 L394 170" fill="none" stroke="${c.ink}" stroke-width="18" stroke-linejoin="round"/>`,
  },
  "5-wordmark": {
    title: "Wordmark-first",
    blurb: "The type carries it; the mark is a single folded page, used like a full stop.",
    draw: (c) => `
      <path d="M104 96 H320 L416 192 V416 H104 Z" fill="${c.ink}"/>
      <path d="M320 96 V192 H416 Z" fill="${c.accent}"/>`,
  },
};

// ---------- wrappers ----------

const svg = (w, h, body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>${body}\n</svg>\n`;

function mark(m, c) { return svg(512, 512, m.draw(c)); }

function icon(m) {
  const c = { ink: PALETTE.white, accent: PALETTE.accent, bg: PALETTE.ink };
  return svg(512, 512, `
      <rect width="512" height="512" rx="116" fill="${PALETTE.ink}"/>
      <g transform="translate(51.2 51.2) scale(0.8)">${m.draw(c)}</g>`);
}

// Brand typeface: IBM Plex Sans JP (Latin + Japanese designed together). Fallbacks for environments without it.
const LATIN = `'IBM Plex Sans JP', 'IBM Plex Sans', Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
const JA = `'IBM Plex Sans JP', 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif`;

/** "Paper Archive" as the query typed into a search field; the mark sits to the left. */
function lockupSearch(m, c, textInk) {
  const field = c.bg, line = textInk;
  return svg(1200, 400, `
      <g transform="translate(40 44) scale(0.61)">${m.draw(c)}</g>
      <rect x="380" y="104" width="780" height="150" rx="75" fill="${field}" stroke="${line}" stroke-width="10" opacity="0.92"/>
      <circle cx="458" cy="179" r="30" fill="none" stroke="${line}" stroke-width="13"/>
      <path d="M480 201 L506 227" stroke="${line}" stroke-width="15" stroke-linecap="round"/>
      <text x="540" y="211" font-family="${LATIN}" font-size="84" font-weight="600" letter-spacing="-1.5" fill="${textInk}">Paper Archive<tspan fill="${c.accent}" font-weight="300" dx="6">|</tspan></text>
      <text x="544" y="322" font-family="${JA}" font-size="42" font-weight="500" fill="${textInk}" opacity="0.72">ペーパーアーカイブ</text>`);
}

function lockup(m, c, textInk) {
  if (m.lockupStyle === "search") return lockupSearch(m, c, textInk);
  return svg(1200, 400, `
      <g transform="translate(60 44) scale(0.61)">${m.draw(c)}</g>
      <text x="400" y="196" font-family="${LATIN}" font-size="104" font-weight="600" letter-spacing="-2" fill="${textInk}">Paper Archive</text>
      <text x="404" y="272" font-family="${JA}" font-size="46" font-weight="500" fill="${textInk}" opacity="0.72">ペーパーアーカイブ</text>`);
}

/** Full-bleed square (no rounding): the OS applies its own mask to PWA / home-screen icons. */
function iconSquare(m) {
  const c = { ink: PALETTE.white, accent: PALETTE.accent, bg: PALETTE.ink };
  return svg(512, 512, `
      <rect width="512" height="512" fill="${PALETTE.ink}"/>
      <g transform="translate(51.2 51.2) scale(0.8)">${m.draw(c)}</g>`);
}

// ---------- final ----------

export const FINAL = "7b-stack-envelope";
function emitFinal() {
  const m = marks[FINAL];
  const d = path.join(here, "final");
  mkdirSync(d, { recursive: true });
  const light = { ink: PALETTE.ink, accent: PALETTE.accent, bg: PALETTE.paper };
  const dark = { ink: PALETTE.white, accent: PALETTE.accent, bg: PALETTE.dark };
  const mono = { ink: PALETTE.ink, accent: PALETTE.ink, bg: PALETTE.paper };
  const files = {
    "mark.svg": mark(m, light), "mark-dark.svg": mark(m, dark), "mark-mono.svg": mark(m, mono),
    "icon-rounded.svg": icon(m), "icon-square.svg": iconSquare(m),
    "lockup.svg": lockup(m, light, PALETTE.ink), "lockup-dark.svg": lockup(m, dark, PALETTE.white),
    // for inlining in HTML: ink = currentColor, card face = the page background
    "mark-inline.svg": svg(512, 512, m.draw({ ink: "currentColor", accent: PALETTE.accent, bg: "var(--bg)" })),
    // favicon: the mark on transparent, viewBox only, scales to any size
    "favicon.svg": svg(512, 512, m.draw({ ink: PALETTE.ink, accent: PALETTE.accent, bg: PALETTE.white })),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(d, name), content);
  console.log(`final (${FINAL}) → brand/final/`);
}
if (process.env.FINAL) emitFinal();

// ---------- emit ----------

mkdirSync(out, { recursive: true });
const rows = [];
const ONLY = process.env.ONLY; // e.g. ONLY=6 renders only directions starting with "6"
for (const [dir, m] of Object.entries(marks)) {
  if (ONLY && !dir.startsWith(ONLY)) continue;
  const d = path.join(out, dir);
  mkdirSync(d, { recursive: true });
  const light = { ink: PALETTE.ink, accent: PALETTE.accent, bg: PALETTE.paper };
  const dark = { ink: PALETTE.white, accent: PALETTE.accent, bg: PALETTE.dark };
  const mono = { ink: PALETTE.ink, accent: PALETTE.ink, bg: PALETTE.paper };
  const files = {
    "mark.svg": mark(m, light),
    "mark-dark.svg": mark(m, dark),
    "mark-mono.svg": mark(m, mono),
    "icon.svg": icon(m),
    "lockup.svg": lockup(m, light, PALETTE.ink),
    "lockup-dark.svg": lockup(m, dark, PALETTE.white),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(d, name), content);
  rows.push({ dir, ...m });
}

// ---------- contact sheet ----------

const panel = (r, theme) => {
  const isDark = theme === "dark";
  const suffix = isDark ? "-dark" : "";
  return `
  <div class="panel ${theme}">
    <img class="lockup" src="${r.dir}/lockup${suffix}.svg" alt="">
    <div class="sizes">
      ${[16, 24, 32, 48, 64].map((s) => `<img src="${r.dir}/mark${suffix}.svg" width="${s}" height="${s}" alt="">`).join("")}
      <img class="app" src="${r.dir}/icon.svg" width="72" height="72" alt="">
      <img src="${r.dir}/mark-mono.svg" width="48" height="48" alt="" style="${isDark ? "filter:invert(1)" : ""}">
    </div>
  </div>`;
};

const sheet = `<!doctype html><meta charset="utf-8"><title>Paper Archive — logo directions</title>
<style>
  body{margin:0;background:#e9e7e2;font:14px/1.4 -apple-system,Inter,sans-serif;color:#1e2a44;padding:24px}
  h1{font-size:18px;margin:0 0 4px} .sub{color:#666;margin:0 0 20px}
  .row{display:grid;grid-template-columns:200px 1fr 1fr;gap:12px;align-items:stretch;margin-bottom:16px}
  .meta h2{font-size:16px;margin:8px 0 6px} .meta p{margin:0;color:#555;font-size:13px}
  .panel{border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;justify-content:space-between;gap:10px}
  .panel.light{background:#f6f3ee} .panel.dark{background:#0f1526}
  .lockup{width:100%;height:auto;display:block}
  .sizes{display:flex;align-items:center;gap:14px;padding-top:6px}
  .sizes img{display:block} .sizes .app{border-radius:16px}
</style>
<h1>Paper Archive — five logo directions</h1>
<p class="sub">Each row: lockup (Latin + ペーパーアーカイブ), then the mark at 16 · 24 · 32 · 48 · 64 px, the app icon, and the monochrome mark. Left panel light, right panel dark.</p>
${rows.map((r) => `
<div class="row">
  <div class="meta"><h2>${r.dir.slice(0, 1)} · ${r.title}</h2><p>${r.blurb}</p></div>
  ${panel(r, "light")}${panel(r, "dark")}
</div>`).join("")}
`;
writeFileSync(path.join(out, "contact-sheet.html"), sheet);
console.log(`wrote ${rows.length} directions × 6 files + contact-sheet.html → brand/out/`);
