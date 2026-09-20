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
`;

const page = (title: string, body: string, lang: ButtonLang = "en") =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title><link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body><main>${MARK}${body}</main></body></html>`;

const COPY = {
  en: { sub: "ペーパーアーカイブ", pitch: "Scan mail → know what it wants → know whether to keep the original.", who: "Invite only" },
  ja: { sub: "Paper Archive", pitch: "郵便物をスキャン → 内容と必要な対応を把握 → 原本を残すか判断", who: "招待制" },
};

export function signInPage(next: string, lang: ButtonLang): Response {
  const href = `/auth/login?next=${encodeURIComponent(next)}`;
  const c = COPY[lang];
  const other = lang === "en" ? "ja" : "en";
  const nextQ = encodeURIComponent(next);
  return new Response(
    page(
      lang === "ja" ? "ペーパーアーカイブ" : "Paper Archive",
      `<h1>${lang === "ja" ? "ペーパーアーカイブ" : "Paper Archive"}</h1><p class="ja">${c.sub}</p>
       <p>${c.pitch}</p>
       <div class="cta">${googleSignInButton(lang, href)}</div>
       <p class="who">${c.who}</p>
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
