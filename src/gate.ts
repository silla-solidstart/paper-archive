/**
 * The pages shown outside the app: the public homepage (which is also the
 * sign-in page), "invite only" (for a Google account that is not on the
 * allow-list), and the share page. Self-contained — no app assets are served
 * to unauthenticated visitors.
 *
 * The homepage is served with 200 and explains what the app does, links the
 * privacy policy and names the operator: Google's branding verification
 * requires a homepage that is not "behind a login page".
 */

const MARK = `<svg viewBox="0 0 512 512" width="72" height="72" aria-hidden="true">
  <rect x="92" y="212" width="212" height="212" rx="26" fill="currentColor"/>
  <rect x="156" y="152" width="212" height="212" rx="26" fill="#e34234" stroke="var(--bg)" stroke-width="10"/>
  <rect x="220" y="92" width="212" height="212" rx="26" fill="var(--bg)" stroke="currentColor" stroke-width="24"/>
  <rect x="258" y="154" width="136" height="94" rx="12" fill="none" stroke="currentColor" stroke-width="18"/>
  <path d="M258 170 L326 222 L394 170" fill="none" stroke="currentColor" stroke-width="18" stroke-linejoin="round"/>
</svg>`;

import { GOOGLE_BUTTON_CSS, googleSignInButton, type ButtonLang } from "./google-button.ts";
import { SITE_QR_SVG, SITE_URL } from "./qr-site.ts";

const STYLE = GOOGLE_BUTTON_CSS + `
  :root { color-scheme: light dark; --bg: #f6f3ee; --fg: #1e2a44; --muted: #6b6b6b; --accent: #e34234; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1526; --fg: #ffffff; --muted: #a0a4b0; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 'IBM Plex Sans JP', -apple-system, 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif; padding: 24px; }
  main { max-width: 420px; text-align: center; }
  h1 { font-size: 22px; margin: 14px 0 4px; letter-spacing: -0.01em; }
  .ja { color: var(--muted); margin: 0 0 22px; }
  p { color: var(--muted); margin: 0 0 8px; }
  .cta { margin-top: 22px; }
  a.btn { display: inline-block; margin-top: 18px; padding: 14px 22px; border-radius: 12px; background: var(--fg); color: var(--bg);
          text-decoration: none; font-weight: 600; }
  a.link { color: var(--accent); }
  .who { font-size: 13px; color: var(--muted); margin-top: 20px; }
  .toggle { font-size: 13px; margin-top: 26px; } .toggle a { color: var(--muted); text-decoration: none; } .toggle b { color: var(--fg); font-weight: 500; }
  h1.tag { font-size: 26px; line-height: 1.25; margin: 18px 0 8px; letter-spacing: -0.01em; word-break: keep-all; overflow-wrap: anywhere; }
  p.lead { color: var(--fg); opacity: .8; max-width: 380px; margin: 0 auto; word-break: keep-all; }
  a.pill { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; font-size: 14px; color: var(--muted); text-decoration: none;
           padding: 8px 14px; border: 1px solid rgba(128,128,128,.35); border-radius: 999px; }
  a.pill:hover { color: var(--fg); }
  /* homepage: what it does, and the footer Google's verification looks for */
  ul.what { list-style: none; padding: 0; margin: 26px auto 0; max-width: 360px; text-align: left; color: var(--fg); opacity: .85; font-size: 14px; }
  ul.what li { display: flex; gap: 10px; align-items: flex-start; margin: 8px 0; }
  ul.what svg { flex: none; width: 18px; height: 18px; margin-top: 2px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  footer.site { margin-top: 34px; font-size: 12px; color: var(--muted); }
  footer.site a { color: var(--muted); }
  /* full-screen share page */
  .qrbox { margin: 28px auto 0; width: min(78vw, 320px); }
  .qrbox svg.qr { display: block; width: 100%; height: auto; background: #fff; border-radius: 12px; }
  .url { font-size: 15px; color: var(--fg); margin-top: 12px; word-break: break-all; }
  .hint { font-size: 14px; color: var(--muted); margin-top: 4px; }
  /* share: mark pinned top, QR centred in the viewport, back pinned bottom */
  body.share { cursor: pointer; display: flex; flex-direction: column; place-items: initial; min-height: 100vh; min-height: 100dvh; padding: 0; }
  body.share .top { padding: calc(28px + env(safe-area-inset-top)) 0 0; text-align: center; }
  body.share .mid { flex: 1; display: grid; place-items: center; padding: 16px 24px; }
  body.share .mid .qrbox { margin: 0; }
  body.share .bot { padding: 0 0 calc(28px + env(safe-area-inset-bottom)); text-align: center; }
  @media print { body { background: #fff; color: #000; } .qrbox { width: 70vw; max-width: 520px; } a.pill, .toggle, .noprint { display: none !important; } }
`;

const page = (title: string, body: string, lang: ButtonLang = "en", bodyClass = "", bare = false) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title><link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body class="${bodyClass}">${bare ? body : `<main>${MARK}${body}</main>`}</body></html>`;

const COPY = {
  en: {
    tag: "Scan it. Know it. Let it go.",
    lead: "Know what's due. Find it after it's gone.",
    who: "Invite only", share: "Share",
    what: [
      "Photograph mail, bills, receipts and school letters with your phone.",
      "Paper Archive reads each one and tells you what it is, what to do and by when.",
      "Receipts are itemised into a monthly spending record.",
      "The photo and a searchable record are kept, and you are told whether the paper can go.",
    ],
    privacy: "Privacy policy", contact: "Contact", operator: "Operated by SolidStart, Jōetsu, Japan",
  },
  ja: {
    tag: "撮る。わかる。手放せる。",
    lead: "いつ何をするかわかる。捨てても探せる。",
    who: "招待制", share: "共有",
    what: [
      "郵便物、請求書、レシート、学校のお知らせをスマホで撮ります。",
      "アプリが内容を読み取り、何の書類か、いつまでに何をすればよいかを伝えます。",
      "レシートは明細ごとに記録され、月ごとの支出がわかります。",
      "写真と検索できる記録を保存し、紙の原本を手放せるかどうかの目安も伝えます。",
    ],
    privacy: "プライバシーポリシー", contact: "お問い合わせ", operator: "運営：SolidStart（新潟県上越市）",
  },
};

const WHAT_ICONS = [
  `<svg viewBox="0 0 24 24"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>`,
  `<svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>`,
  `<svg viewBox="0 0 24 24"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg>`,
  `<svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
];

const siteFooter = (c: (typeof COPY)["en"]) =>
  `<footer class="site">${c.operator} · <a href="/privacy">${c.privacy}</a> · <a href="mailto:privacy@solidstart.jp">${c.contact}</a></footer>`;

const SHARE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`;

export function signInPage(next: string, lang: ButtonLang): Response {
  const href = `/auth/login?next=${encodeURIComponent(next)}`;
  const c = COPY[lang];
  const other = lang === "en" ? "ja" : "en";
  const nextQ = encodeURIComponent(next);
  return new Response(
    page(
      "Paper Archive",
      `<h1 class="tag">${c.tag}</h1>
       <p class="lead">${c.lead}</p>
       <div class="cta">${googleSignInButton(lang, href)}</div>
       <p class="who">Paper Archive · ${c.who}</p>
       <ul class="what">${c.what.map((w, i) => `<li>${WHAT_ICONS[i]}<span>${w}</span></li>`).join("")}</ul>
       <p><a class="pill" href="/share?lang=${lang}">${SHARE_ICON}${c.share}</a></p>
       <p class="toggle"><a href="?lang=${other}&next=${nextQ}">${lang === "en" ? "日本語" : "English"}</a></p>
       ${siteFooter(c)}`,
      lang,
    ),
    // 200, not 401: this is the public homepage as well as the sign-in page.
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Vary: "Accept-Language" } },
  );
}

export function notInvitedPage(email: string, lang: ButtonLang = "en"): Response {
  const safe = email.replace(/[<>&"]/g, "");
  const en = lang === "en";
  return new Response(
    page(
      en ? "Paper Archive — invite only" : "Paper Archive（招待制）",
      en
        ? `<h1>Invite only</h1><p class="ja">招待制のアプリです</p>
           <p><b>${safe}</b> isn't on the list. Ask the person who runs this archive to add you, then sign in again.</p>
           <a class="btn" href="/auth/logout">Try another account</a>`
        : `<h1>招待制のアプリです</h1><p class="ja">Invite only</p>
           <p><b>${safe}</b> は登録されていません。管理者に追加を依頼してから、もう一度ログインしてください。</p>
           <a class="btn" href="/auth/logout">別のアカウントでログイン</a>`,
      lang,
    ),
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export function sharePage(lang: ButtonLang): Response {
  const back = lang === "en" ? "Back" : "戻る";
  return new Response(
    page(
      lang === "ja" ? "Paper Archiveを共有" : "Share Paper Archive",
      `<div class="top">${MARK}</div>
       <div class="mid"><div class="qrbox">${SITE_QR_SVG}</div></div>
       <div class="bot noprint"><a class="pill" href="/?lang=${lang}">${back}</a></div>
       <script>
         // Tap anywhere that is not the button to go back; Escape too.
         document.body.addEventListener("click", (e) => { if (!e.target.closest("a")) location.href = "/?lang=${lang}"; });
         document.addEventListener("keydown", (e) => { if (e.key === "Escape") location.href = "/?lang=${lang}"; });
       </script>`,
      lang,
      "share",
      true,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", Vary: "Accept-Language" } },
  );
}
