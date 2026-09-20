/**
 * The pages shown outside the app: sign-in (for anyone not signed in) and
 * "invite only" (for a Google account that is not on the allow-list).
 * Self-contained — no app assets are served to unauthenticated visitors.
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
  h1.tag { font-size: 26px; line-height: 1.25; margin: 18px 0 8px; letter-spacing: -0.01em; }
  p.lead { color: var(--fg); opacity: .8; max-width: 380px; margin: 0 auto; }
  a.pill { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; font-size: 14px; color: var(--muted); text-decoration: none;
           padding: 8px 14px; border: 1px solid rgba(128,128,128,.35); border-radius: 999px; }
  a.pill:hover { color: var(--fg); }
  /* full-screen share page */
  .qrbox { margin: 22px auto 0; width: min(78vw, 300px); }
  .qrbox svg.qr { display: block; width: 100%; height: auto; background: #fff; border-radius: 12px; }
  .url { font-size: 15px; color: var(--fg); margin-top: 12px; word-break: break-all; }
  .hint { font-size: 14px; color: var(--muted); margin-top: 4px; }
  body.share { cursor: pointer; }
  @media print { body { background: #fff; color: #000; } .qrbox { width: 70vw; max-width: 520px; } a.pill, .toggle, .noprint { display: none !important; } }
`;

const page = (title: string, body: string, lang: ButtonLang = "en", bodyClass = "") =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title><link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body class="${bodyClass}"><main>${MARK}${body}</main></body></html>`;

const COPY = {
  en: {
    tag: "Scan it. Forget it. Find it.",
    lead: "Paper mail that explains itself — what it is, what it wants from you, and whether you can throw it away.",
    who: "Invite only", share: "Share", share_hint: "Scan to open Paper Archive",
  },
  ja: {
    tag: "撮る。忘れる。見つかる。",
    lead: "撮るだけで、わかる。何の書類か、何をすべきか、捨てていいか。",
    who: "招待制", share: "共有", share_hint: "スキャンするとPaper Archiveが開きます",
  },
};

const SHARE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`;

export function signInPage(next: string, lang: ButtonLang): Response {
  const href = `/auth/login?next=${encodeURIComponent(next)}`;
  const c = COPY[lang];
  const other = lang === "en" ? "ja" : "en";
  const nextQ = encodeURIComponent(next);
  return new Response(
    page(
      lang === "ja" ? "ペーパーアーカイブ" : "Paper Archive",
      `<h1 class="tag">${c.tag}</h1>
       <p class="lead">${c.lead}</p>
       <div class="cta">${googleSignInButton(lang, href)}</div>
       <p class="who">Paper Archive · ${c.who}</p>
       <p><a class="pill" href="/share?lang=${lang}">${SHARE_ICON}${c.share}</a></p>
       <p class="toggle"><a href="?lang=${other}&next=${nextQ}">${lang === "en" ? "日本語" : "English"}</a></p>`,
      lang,
    ),
    { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Vary: "Accept-Language" } },
  );
}

export function notInvitedPage(email: string, lang: ButtonLang = "en"): Response {
  const safe = email.replace(/[<>&"]/g, "");
  const en = lang === "en";
  return new Response(
    page(
      en ? "Paper Archive — invite only" : "ペーパーアーカイブ — 招待制",
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
  const c = COPY[lang];
  const other = lang === "en" ? "ja" : "en";
  const back = lang === "en" ? "Back" : "戻る";
  const print = lang === "en" ? "Print" : "印刷";
  return new Response(
    page(
      lang === "ja" ? "ペーパーアーカイブを共有" : "Share Paper Archive",
      `<h1 class="tag">${c.tag}</h1>
       <p class="lead">${c.share_hint}</p>
       <div class="qrbox">${SITE_QR_SVG}</div>
       <div class="url">${SITE_URL}</div>
       <p class="hint">Paper Archive · ${c.who}</p>
       <p class="noprint"><a class="pill" href="/?lang=${lang}">${back}</a> <a class="pill" href="#" data-print>${print}</a></p>
       <p class="toggle noprint"><a href="/share?lang=${other}">${lang === "en" ? "日本語" : "English"}</a></p>
       <script>
         // Tap anywhere that is not a link to go back; Escape too.
         document.body.addEventListener("click", (e) => {
           const a = e.target.closest("a");
           if (a && a.hasAttribute("data-print")) { e.preventDefault(); window.print(); return; }
           if (!a) location.href = "/?lang=${lang}";
         });
         document.addEventListener("keydown", (e) => { if (e.key === "Escape") location.href = "/?lang=${lang}"; });
       </script>`,
      lang,
      "share",
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", Vary: "Accept-Language" } },
  );
}
