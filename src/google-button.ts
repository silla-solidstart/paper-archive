/**
 * The standard "Sign in with Google" button, per Google's branding guidelines:
 * the four-colour G on a white tile, Roboto Medium 14 px, 40 px tall,
 * 1 px border; light / dark variants with Google's specified colours; one
 * language per button. Japanese string is Google's own: 「Google でログイン」.
 *
 * Shared by the server-rendered gate page and (as a copy of the same markup
 * and CSS) the app in public/.
 */

export type ButtonLang = "en" | "ja";

export const GOOGLE_G = `<svg class="gsi-g" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

export const LABEL: Record<ButtonLang, string> = { en: "Sign in with Google", ja: "Google でログイン" };

export const GOOGLE_BUTTON_CSS = `
  .gsi { display: inline-flex; align-items: center; height: 40px; padding: 0 12px; box-sizing: border-box;
         border-radius: 4px; border: 1px solid #747775; background: #fff; color: #1f1f1f;
         font: 500 14px/20px Roboto, -apple-system, 'Hiragino Sans', 'Noto Sans JP', Arial, sans-serif;
         letter-spacing: .25px; text-decoration: none; cursor: pointer; white-space: nowrap; user-select: none;
         transition: background-color .2s, box-shadow .2s; }
  .gsi:hover { box-shadow: 0 1px 2px rgba(60,64,67,.30), 0 1px 3px 1px rgba(60,64,67,.15); }
  .gsi:focus-visible { outline: 2px solid #4285f4; outline-offset: 2px; }
  .gsi-g { width: 20px; height: 20px; margin-right: 10px; flex: none; }
  @media (prefers-color-scheme: dark) {
    .gsi { background: #131314; color: #e3e3e3; border-color: #8e918f; }
    .gsi:hover { box-shadow: 0 1px 2px rgba(0,0,0,.6); }
  }
`;

export function googleSignInButton(lang: ButtonLang, href: string, extraClass = ""): string {
  return `<a class="gsi ${extraClass}" href="${href}" lang="${lang}">${GOOGLE_G}<span>${LABEL[lang]}</span></a>`;
}
