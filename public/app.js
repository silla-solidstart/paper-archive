/* Paper Archive — one file, no build step.
 *
 * Screens (hash routes): #/ camera · #/archive (list + search) · #/actions · #/doc/:id
 *                        #/spaces · #/space/:id · #/join/:token
 * Auth: session cookie from Sign in with Google, or a bearer token pasted into
 * the disclosure on the scan screen (pre-sign-in tester mode).
 * Language: EN / 日本語 — UI strings here, and the model writes the summary
 * and retention reason in the same language (sent as X-Lang).
 * Spaces: everything you see is the current space; files go to the space
 * private R2 storage; the Worker serves them to members of the archive.
 */
"use strict";

// ?theme=light|dark overrides the OS setting (testing, screenshots); persisted per device.
{ const th = new URLSearchParams(location.search).get("theme");
  try { if (th === "light" || th === "dark") localStorage.setItem("pa_theme", th); if (th === "auto") localStorage.removeItem("pa_theme"); } catch {}
  let saved = null; try { saved = localStorage.getItem("pa_theme"); } catch {}
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved; }

const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.85;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view"), who = $("#who"), fileCam = $("#fileCam"), fileUp = $("#fileUp"), langBtn = $("#lang"), shareBtn = $("#shareBtn"), adminBtn = $("#adminBtn"), spendBtn = $("#spendBtn"),
      menuBtn = $("#menuBtn"), menu = $("#menu"), signoutEl = $("#signout"), archivesEl = $("#archives"), archLabel = $("#archLabel"), avatarText = $("#avatarText");

// Google's standard sign-in button: four-colour G, Roboto, one language per button (spec in src/google-button.ts).
const GOOGLE_G = `<svg class="gsi-g" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;
const gsiButton = (href, extra = "") => `<a class="gsi ${extra}" href="${href}" lang="${state.lang}">${GOOGLE_G}<span>${t("signin")}</span></a>`;

// Lucide icons (public/icons.js). icon(name) returns inline SVG that follows currentColor.
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${(window.LUCIDE || {})[name] || ""}</svg>`;
function paintIcons(root = document) { root.querySelectorAll("i[data-icon]").forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon); }); }

const state = { signedIn: false, user: null, space: null, spaces: [], admin: false, token: "", lastResult: null, lang: "en" };
try { state.token = localStorage.getItem("pa_token") || ""; } catch {}
try {
  const saved = localStorage.getItem("pa_lang");
  state.lang = saved === "ja" || saved === "en" ? saved : (/^ja\b/i.test(navigator.language) ? "ja" : "en");
} catch { state.lang = /^ja\b/i.test(navigator.language) ? "ja" : "en"; }

// ---------- i18n ----------

const STR = {
  en: {
    tab_camera: "Camera", tab_archive: "Papers", tab_todo: "To do",
    sub: "Scan it. Know it. Let it go.",
    signin: "Sign in with Google", signout: "Sign out",
    token_toggle: "Use an API token instead",
    preparing: "Preparing…", reading: (kb) => `Reading ${kb} KB… (OCR, then understanding)`,
    failed: "Failed", need_auth: "Sign in, or paste an API token below.",
    dry_hint: "Test run — nothing was saved.", view_photo: "View photo", photo_missing: "Photo not found.",
    ios_hint: "Add to your Home Screen: Share → Add to Home Screen", dismiss: "Dismiss",
    saved: "Saved", reading_now: "Reading it now…", leave_ok: "You can leave this screen. It will show up in Papers when it's done.",
    pill_reading: "reading…", reading_doc: "Still reading this document…", uploading: "Uploading…",
    retention: { digital_sufficient: "◎ Digital copy likely sufficient", keep_temporarily: "◍ Keep temporarily", keep_original: "◑ Keep original", unsure: "⚠ Unsure — your call" },
    decide: { digital_sufficient: "Digital is enough", keep_temporarily: "Keep for now", keep_original: "Keep original" },
    action_required: "Action required", action: { payment: "payment", appointment: "appointment", renewal: "renewal", signature: "signature", response: "response", cancellation: "cancellation" },
    overdue: (d) => `overdue by ${d}d`, due_today: "due today", due_in: (d) => `due in ${d}d`, due_on: (date) => `due ${date}`,
    pill_review: "review",
    needs_action: "Needs action", nothing_yet: "No papers in this archive yet.", nothing_due: "Nothing needs action.",
    search_ph: "Property tax, Tokyo Gas, Jōetsu…", no_matches: "No matches.",
    loading: "Loading…", could_not_load: (m) => `Could not load: ${m}`, no_db: "No database configured yet.",
    gate: "Sign in with Google, or paste an API token on the Camera screen.", not_found: "Not found.",
    ocr: (pages, chars) => `OCR (${pages} page${pages === 1 ? "" : "s"}, ${chars} chars)`, ocr_text: "OCR text",
    indexed: "indexed", not_indexed: "not indexed", open: "open", back_archive: "← Papers", delete: "Delete", details: "Details",
    confirm_delete: "Remove this document and its photo from the archive?",
    delete_failed: (m) => `Delete failed: ${m}`, save_failed: (m) => `Could not save: ${m}`,
    cost: (jpy, usd, tokens) => `≈ ¥${jpy} (US$${usd}) · ${tokens.toLocaleString()} tokens`,
    cost_short: (jpy) => `≈ ¥${jpy}`,
    fields: { type: "Type", issuer: "Issuer", date: "Date", amount: "Amount", due: "Due", reference: "Reference", categories: "Categories", status: "Status", model: "Model", ocr: "OCR", lang: "Interpreted in", cost: "Cost", scanned_by: "Captured by" },
    doctype: { tax_notice: "Tax notice", government_notice: "Government notice", utility_bill: "Utility bill", insurance: "Insurance", bank_statement: "Bank statement", invoice: "Invoice", receipt: "Receipt", school_letter: "School letter", medical: "Medical", contract: "Contract", subscription: "Subscription", advertisement: "Advertisement", other: "Other" },
    lang_name: { en: "English", ja: "日本語" },
    category: { tax: "tax", property: "property", utilities: "utilities", insurance: "insurance", finance: "finance", education: "education", health: "health", legal: "legal", employment: "employment", housing: "housing", vehicle: "vehicle", government: "government", shopping: "shopping", other: "other" },
    // spaces
    spaces: "Archives", space: "Archive", your_archive: "Your archive", shared_with_you: "Shared with you", current: "default", owner: "yours", member: "shared",
    members_n: (n) => `${n} ${n === 1 ? "person" : "people"}`,
    archives_hint: "You have one archive of your own. If someone shares theirs with you, you can make it your default and switch back any time. New documents go into your default archive.",
    no_shared: "Nobody has shared an archive with you yet.",
    settings: "Settings", rename: "Rename", save: "Save", members: "People", remove: "Remove", leave: "Leave this archive",
    confirm_leave: "Leave this archive? You will no longer see its documents.", confirm_remove: (n) => `Remove ${n} from this archive?`,
    shared_by: (n) => `Shared by ${n}`,
    invites: "Share this archive", invite_hint: "Show the QR or send the link. It works for 7 days, up to 10 people; they sign in with Google and see everything in this archive.",
    create_invite: "Create invite link", copy: "Copy link", copied: "Copied", revoke: "Revoke", expires: (d) => `expires ${d}`, uses: (u, m) => `${u}/${m} used`,
    join_title: "Join a space", join_desc: (space, by) => `You've been invited to <b>${esc(space)}</b>${by ? ` by ${esc(by)}` : ""}.`,
    join: "Join", joined: (name) => `You're in ${name}.`, invite_invalid: "This invite link is invalid.", invite_expired: "This invite link has expired or was used up.",
    switch_to: "Make default",
    share: "Share", share_app: "Share the app", share_app_hint: "Scan it. Know it. Let it go. Print this and put it where the mail lands.",
    share_space: (n, own) => own ? "Share your archive" : `Invite to ${n}`, share_space_hint: "Scan to join. The link works for 7 days, up to 10 people; they sign in with Google and see everything in this archive.",
    share_native: "Share…", print: "Print", open_link: "Open",
    signed_in_as: "Signed in as", take_photo: "Take a photo", upload: "Upload a file", api_token_link: "Use an API token", yours_short: "yours",
    admin: "Admin", admin_title: "Who can sign in", admin_hint: "Invite-only. Add an email, or @domain for everyone at a domain. Removal takes effect on their next request.",
    admin_bootstrap: (list) => `Always allowed (config): ${list}`, entry: "Email or @domain", role: "Role", note: "Note (optional)", added: "Added", add: "Add",
    role_admin: "admin", role_member: "member", confirm_remove_entry: (e) => `Remove ${e} from the allow-list?`,
    costs_title: "Costs, all users", attempts: "scans", spend: "spend", avg_scan: "avg / scan", by_user: "By user", this_month: "this month", reanalyses_n: (n) => `${n} re-read${n === 1 ? "" : "s"}`,
    // v2: labels, sender, expenses, re-analysis
    handling: { todo: "To do", expense: "Expense", record: "Record", notice: "Notice", noise: "Junk" },
    expense_kind: { groceries: "Groceries", dining: "Dining", transport: "Transport", utilities: "Utilities", housing: "Housing", medical: "Medical", education: "Education", clothing: "Clothing", household: "Household", electronics: "Electronics", entertainment: "Entertainment", subscription: "Subscription", insurance: "Insurance", tax: "Tax", business: "Business", other: "Other" },
    item_category: { groceries: "Groceries", snacks: "Snacks", alcohol: "Alcohol", beverages: "Drinks", household: "Household", dining: "Dining", transport: "Transport", utilities: "Utilities", medical: "Medical", education: "Education", clothing: "Clothing", electronics: "Electronics", entertainment: "Entertainment", subscription: "Subscription", fees: "Fees", tax: "Tax", business: "Business", other: "Other" },
    who_from: "Who is it from?", from_ph: "e.g. 宮原, Joetsu City", from_missing: "The paper doesn't say who sent it.", edit: "Edit",
    reanalyze: "Re-analyze", reanalyzing: "Re-analyzing…", reanalyzed: "Updated with the latest reading.", reanalyze_failed: (m) => `Re-analysis failed: ${m}`,
    filed_pending: "The photo is saved, but reading it failed. Open it and re-analyze to try again.",
    pill_failed: "not read", version: "Reading version",
    expense: "Expense", items: "Items", total: "Total", tax: "Tax", payment: "Paid by", kind: "Kind", merchant: "Merchant",
    payment_method: { cash: "cash", card: "card", transfer: "bank transfer", direct_debit: "direct debit", e_money: "e-money", other: "other" },
    spending: "Spending", by_category: "By item category", by_kind: "By kind", by_merchant: "By merchant", receipts: "Receipts and bills",
    no_spending: "No expenses recorded this month.", items_n: (n) => `${n} item${n === 1 ? "" : "s"}`, expenses_n: (n) => `${n} document${n === 1 ? "" : "s"}`,
    tables: "Tables",
  },
  ja: {
    tab_camera: "撮影", tab_archive: "書類", tab_todo: "要対応",
    sub: "撮る。わかる。手放せる。",
    signin: "Google でログイン", signout: "ログアウト",
    token_toggle: "APIトークンを使う",
    preparing: "準備中", reading: (kb) => `${kb} KB を読み取り中（OCRのあと解析）`,
    failed: "失敗", need_auth: "ログインするか、下にAPIトークンを入力してください。",
    dry_hint: "テスト実行のため保存していません。", view_photo: "写真を見る", photo_missing: "写真が見つかりません。",
    ios_hint: "ホーム画面に追加できます：共有 → ホーム画面に追加", dismiss: "閉じる",
    saved: "保存しました", reading_now: "読み取り中です", leave_ok: "この画面を離れても大丈夫です。読み取りが終わると「書類」に表示されます。",
    pill_reading: "読み取り中", reading_doc: "読み取り中です。終わると自動で表示されます。", uploading: "アップロード中",
    retention: { digital_sufficient: "◎ デジタルで十分", keep_temporarily: "◍ しばらく保管", keep_original: "◑ 原本を保管", unsure: "⚠ 判断が必要" },
    decide: { digital_sufficient: "デジタルで十分", keep_temporarily: "しばらく保管", keep_original: "原本を保管" },
    action_required: "要対応", action: { payment: "支払い", appointment: "予約", renewal: "更新", signature: "署名", response: "回答", cancellation: "解約" },
    overdue: (d) => `${d}日超過`, due_today: "今日が期限", due_in: (d) => `あと${d}日`, due_on: (date) => `期限 ${date}`,
    pill_review: "要確認",
    needs_action: "要対応", nothing_yet: "このアーカイブにはまだ書類がありません。", nothing_due: "いま、やることはありません。",
    search_ph: "固定資産税、東京ガス、上越市 など", no_matches: "見つかりませんでした。",
    loading: "読み込み中", could_not_load: (m) => `読み込めませんでした: ${m}`, no_db: "データベースが未設定です。",
    gate: "Googleでログインするか、撮影画面でAPIトークンを入力してください。", not_found: "見つかりません。",
    ocr: (pages, chars) => `OCR（${pages}ページ、${chars}文字）`, ocr_text: "OCRテキスト",
    indexed: "登録済み", not_indexed: "未登録", open: "開く", back_archive: "← 書類", delete: "削除", details: "詳細",
    confirm_delete: "この書類と写真をアーカイブから削除しますか？",
    delete_failed: (m) => `削除できませんでした: ${m}`, save_failed: (m) => `保存できませんでした: ${m}`,
    cost: (jpy, usd, tokens) => `約¥${jpy}（US$${usd}）・${tokens.toLocaleString()}トークン`,
    cost_short: (jpy) => `約¥${jpy}`,
    fields: { type: "種類", issuer: "差出人", date: "日付", amount: "金額", due: "期限", reference: "番号", categories: "分類", status: "状態", model: "モデル", ocr: "OCR", lang: "解析言語", cost: "費用", scanned_by: "撮影した人" },
    doctype: { tax_notice: "納税通知書", government_notice: "行政からの通知", utility_bill: "公共料金", insurance: "保険", bank_statement: "銀行明細", invoice: "請求書", receipt: "領収書", school_letter: "学校からのお知らせ", medical: "医療", contract: "契約書", subscription: "定期契約", advertisement: "広告", other: "その他" },
    lang_name: { en: "English", ja: "日本語" },
    category: { tax: "税金", property: "不動産", utilities: "公共料金", insurance: "保険", finance: "金融", education: "教育", health: "健康", legal: "法律", employment: "仕事", housing: "住まい", vehicle: "車", government: "行政", shopping: "買い物", other: "その他" },
    spaces: "アーカイブ", space: "アーカイブ", your_archive: "自分のアーカイブ", shared_with_you: "共有されたアーカイブ", current: "既定", owner: "所有者", member: "メンバー",
    members_n: (n) => `${n}人`,
    archives_hint: "自分のアーカイブは1つです。誰かにアーカイブを共有されたら、そちらを既定にすることも、いつでも元に戻すこともできます。新しい書類は既定のアーカイブに入ります。",
    no_shared: "まだ共有されたアーカイブはありません。",
    settings: "設定", rename: "名前を変更", save: "保存", members: "メンバー", remove: "削除", leave: "このアーカイブから退出",
    confirm_leave: "このアーカイブから退出しますか？書類は見えなくなります。", confirm_remove: (n) => `${n} をこのアーカイブから削除しますか？`,
    shared_by: (n) => `${n} が共有`,
    invites: "このアーカイブを共有", invite_hint: "QRを見せるか、リンクを送ってください。7日間・最大10人まで有効。相手はGoogleでログインすると、このアーカイブの書類をすべて見られます。",
    create_invite: "招待リンクを作成", copy: "リンクをコピー", copied: "コピーしました", revoke: "無効化", expires: (d) => `有効期限 ${d}`, uses: (u, m) => `${u}/${m}人`,
    join_title: "アーカイブに参加", join_desc: (space, by) => `${by ? `${esc(by)} から` : ""}<b>${esc(space)}</b> に招待されています。`,
    join: "参加", joined: (name) => `${name} に参加しました。`, invite_invalid: "この招待リンクは無効です。", invite_expired: "この招待リンクは期限切れか、使用回数の上限に達しています。",
    switch_to: "既定にする",
    share: "共有", share_app: "アプリを共有", share_app_hint: "撮る。わかる。手放せる。印刷して、郵便物の置き場に。",
    share_space: (n, own) => own ? "自分のアーカイブを共有" : `「${n}」に招待`, share_space_hint: "QRをスキャンすると参加できます。リンクは7日間・最大10人まで有効。相手はGoogleでログインすると、このアーカイブの書類をすべて見られます。",
    share_native: "共有", print: "印刷", open_link: "開く",
    signed_in_as: "ログイン中", take_photo: "写真を撮る", upload: "ファイルを選ぶ", api_token_link: "APIトークンを使う", yours_short: "自分",
    admin: "管理", admin_title: "ログインできる人", admin_hint: "招待制です。メールアドレスを追加します。ドメイン全体を許可するには @ドメイン の形で追加してください。削除は相手の次回アクセスから反映されます。",
    admin_bootstrap: (list) => `常に許可（設定）: ${list}`, entry: "メールアドレスまたは @ドメイン", role: "権限", note: "メモ（任意）", added: "追加日", add: "追加",
    role_admin: "管理者", role_member: "メンバー", confirm_remove_entry: (e) => `${e} を許可リストから削除しますか？`,
    costs_title: "費用（全ユーザー）", attempts: "件", spend: "合計", avg_scan: "1件あたり", by_user: "ユーザー別", this_month: "今月", reanalyses_n: (n) => `読み取り直し${n}件`,
    handling: { todo: "要対応", expense: "支出", record: "記録", notice: "お知らせ", noise: "広告" },
    expense_kind: { groceries: "食料品", dining: "外食", transport: "交通", utilities: "公共料金", housing: "住まい", medical: "医療", education: "教育", clothing: "衣類", household: "日用品", electronics: "家電", entertainment: "娯楽", subscription: "定期契約", insurance: "保険", tax: "税金", business: "事業", other: "その他" },
    item_category: { groceries: "食料品", snacks: "お菓子", alcohol: "お酒", beverages: "飲料", household: "日用品", dining: "外食", transport: "交通", utilities: "公共料金", medical: "医療", education: "教育", clothing: "衣類", electronics: "家電", entertainment: "娯楽", subscription: "定期契約", fees: "手数料", tax: "税金", business: "事業", other: "その他" },
    who_from: "差出人は？", from_ph: "例: 宮原、上越市", from_missing: "差出人が書かれていません。", edit: "編集",
    reanalyze: "読み取り直す", reanalyzing: "読み取り中", reanalyzed: "最新の読み取りに更新しました。", reanalyze_failed: (m) => `読み取り直せませんでした: ${m}`,
    filed_pending: "写真は保存できましたが、読み取れませんでした。開いて読み取り直してください。",
    pill_failed: "未読み取り", version: "読み取り版",
    expense: "支出", items: "明細", total: "合計", tax: "税額", payment: "支払い方法", kind: "種類", merchant: "支払先",
    payment_method: { cash: "現金", card: "カード", transfer: "振込", direct_debit: "口座振替", e_money: "電子マネー", other: "その他" },
    spending: "支出", by_category: "品目別", by_kind: "種類別", by_merchant: "支払先別", receipts: "レシート・請求書",
    no_spending: "この月の支出はありません。", items_n: (n) => `${n}点`, expenses_n: (n) => `${n}件`,
    tables: "表",
  },
};
const t = (key, ...args) => { const v = STR[state.lang][key]; return typeof v === "function" ? v(...args) : v; };
const tt = (group, key) => (STR[state.lang][group] || {})[key] ?? key;

function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll(".tabs a").forEach((a) => { a.lastChild.textContent = t("tab_" + a.dataset.tab); });
  langBtn.querySelector("span").textContent = state.lang === "en" ? "日本語" : "EN";
  langBtn.title = t("lang_name")[state.lang === "en" ? "ja" : "en"];
  shareBtn.querySelector("span").textContent = t("share");
  spendBtn.querySelector("span").textContent = t("spending");
  adminBtn.querySelector("span").textContent = t("admin");
  signoutEl.querySelector("span").textContent = t("signout");
  archLabel.textContent = t("space");
  paintIcons();
  renderSpaceBtn();
}
function openMenu(open) { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); }
menuBtn.addEventListener("click", (e) => { e.stopPropagation(); openMenu(menu.hidden); });
document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) openMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") openMenu(false); });
window.addEventListener("hashchange", () => openMenu(false));
shareBtn.addEventListener("click", () => { location.hash = "#/share"; });
adminBtn.addEventListener("click", () => { location.hash = "#/admin"; });
spendBtn.addEventListener("click", () => { location.hash = "#/spending"; });
langBtn.addEventListener("click", () => {
  state.lang = state.lang === "en" ? "ja" : "en";
  try { localStorage.setItem("pa_lang", state.lang); } catch {}
  applyLang(); renderWho(); route();
});

// ---------- api ----------

function authHeaders(extra = {}) {
  const h = { "X-Lang": state.lang, ...extra };
  if (!state.signedIn && state.token) h["Authorization"] = "Bearer " + state.token;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: authHeaders(opts.headers || {}) });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}
const postJson = (path, data, method = "POST") => api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

function canCall() { return state.signedIn || Boolean(state.token); }

async function whoami() {
  try {
    const { user, space, admin } = await api("/api/me");
    state.signedIn = true; state.user = user; state.space = space; state.admin = Boolean(admin);
  } catch { state.signedIn = false; state.user = null; state.admin = false; }
  state.spaces = [];
  if (canCall()) {
    try {
      const { spaces, current } = await api("/api/spaces");
      state.spaces = spaces;
      state.space = spaces.find((s) => s.id === current) || state.space || null;
      if (!state.signedIn) state.admin = true; // the bearer token is the operator
    } catch {}
  }
  renderWho(); renderSpaceBtn();
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  // Latin: first letters of first two words; CJK: first character.
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(parts[0])) return parts[0].slice(0, 1);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function renderWho() {
  if (state.signedIn) {
    who.innerHTML = `<div>${t("signed_in_as")}</div><div class="name">${esc(state.user.name || state.user.email)}</div><div>${esc(state.user.email)}</div>`;
    avatarText.textContent = initials(state.user.name || state.user.email);
  } else {
    who.innerHTML = gsiButton("/auth/login");
    avatarText.innerHTML = state.token ? icon("key-round") : icon("user");
  }
  signoutEl.hidden = !state.signedIn;
}

function renderSpaceBtn() {
  adminBtn.hidden = !state.admin;
  const hasArchives = canCall() && state.spaces.length > 0;
  archLabel.hidden = !hasArchives; archivesEl.hidden = !hasArchives;
  archivesEl.innerHTML = "";
  for (const s of state.spaces) {
    const on = state.space && s.id === state.space.id;
    const row = document.createElement("div");
    row.className = "arch" + (on ? " on" : "");
    row.setAttribute("role", "menuitemradio"); row.setAttribute("aria-checked", String(!!on));
    row.innerHTML = `<span class="dot"></span><span class="t"><b>${esc(s.name)}</b><small>${s.role === "owner" ? t("yours_short") : t("shared_by", esc(s.owner_name || ""))}</small></span>
      <a class="gear" href="#/space/${s.id}" title="${t("settings")}">${icon("settings")}</a>`;
    row.addEventListener("click", async (e) => {
      if (e.target.closest(".gear")) return;
      if (on) { openMenu(false); return; }
      try { await api(`/api/spaces/${s.id}/select`, { method: "POST" }); await whoami(); state.lastResult = null; openMenu(false); route(); }
      catch (err) { alert(err.message); }
    });
    archivesEl.appendChild(row);
  }
}

// ---------- router ----------

const routes = [
  [/^#\/?$/, scanView],
  [/^#\/archive$/, archiveView],
  [/^#\/(recent|search)$/, () => { location.hash = "#/archive"; }], // old links
  [/^#\/actions$/, actionsView],
  [/^#\/doc\/([0-9a-f-]{36})$/, docView],
  [/^#\/spaces$/, spacesView],
  [/^#\/space\/([0-9a-f-]{36})$/, spaceView],
  [/^#\/join\/([A-Za-z0-9_-]{20,64})$/, joinView],
  [/^#\/share$/, shareView],
  [/^#\/spending(?:\/(\d{4}-\d{2}))?$/, spendingView],
  [/^#\/admin$/, adminView],
];

async function route() {
  const hash = location.hash || "#/";
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll(".tabs a").forEach((a) => {
        const href = a.getAttribute("href");
        a.classList.toggle("active", href === "#/" ? hash === "#/" : hash.startsWith(href));
      });
      view.innerHTML = "";
      await fn(...m.slice(1));
      return;
    }
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", route);

// ---------- views ----------

function gate() {
  if (canCall()) return false;
  view.innerHTML = `<div class="empty">${t("gate")}</div>`;
  return true;
}

async function scanView() {
  view.innerHTML = `
    <div class="scanwrap">
      <button class="shutter" id="scanBtn" aria-label="${esc(t("take_photo"))}">${icon("camera")}</button>
      <div class="meta">${t("take_photo")}</div>
      <div style="margin-top:18px"><button class="upload" id="uploadBtn">${icon("upload")} ${t("upload")}</button></div>
      ${state.signedIn ? "" : `<details class="token" id="tokenBox"><summary>${t("api_token_link")}</summary>
        <input id="token" type="password" placeholder="APP_BEARER_TOKEN" autocomplete="off" value="${esc(state.token)}"></details>`}
      ${iosHint()}
    </div>
    <div class="status" id="status"></div>
    <div id="result"></div>`;
  $("#scanBtn").addEventListener("click", () => fileCam.click());
  const hint = $("#iosHint");
  if (hint) hint.querySelector("button").addEventListener("click", () => { try { localStorage.setItem("pa_ios_hint", "1"); } catch {} hint.remove(); });
  $("#uploadBtn").addEventListener("click", () => fileUp.click());
  const tokenEl = $("#token");
  if (tokenEl) tokenEl.addEventListener("change", async () => {
    state.token = tokenEl.value.trim();
    try { localStorage.setItem("pa_token", state.token); } catch {}
    await whoami();
  });
  if (state.lastResult) $("#result").appendChild(resultCard(state.lastResult));
}

for (const input of [fileCam, fileUp]) input.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (location.hash && location.hash !== "#/") { location.hash = "#/"; await new Promise((r) => setTimeout(r, 0)); }
  await process(file);
});

async function downscale(file) {
  if (file.type === "application/pdf") return { blob: file, type: "application/pdf" };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
  return { blob, type: "image/jpeg" };
}

async function process(file) {
  const btn = $("#scanBtn"), up = $("#uploadBtn"), status = $("#status"), result = $("#result");
  if (!canCall()) { status.textContent = t("need_auth"); return; }
  btn.disabled = true; if (up) up.disabled = true;
  try {
    status.textContent = t("preparing");
    const { blob, type } = await downscale(file);
    status.textContent = t("uploading");
    const data = await api("/api/process", {
      method: "POST",
      headers: { "Content-Type": type, "X-Filename": encodeURIComponent(file.name || "scan") },
      body: blob,
    });
    status.textContent = "";
    result.innerHTML = "";
    if (data.status === "pending") {
      // Stored. The reading continues on the server; show it if we are still here when it lands.
      const card = document.createElement("div");
      card.className = "card saved";
      card.innerHTML = `<h3>${icon("circle-check")} ${t("saved")}</h3><div class="meta" id="readState">${icon("refresh-cw")} ${t("reading_now")}</div><div class="meta">${t("leave_ok")}</div>
        <div class="decide"><a href="#/doc/${esc(data.id)}"><button>${t("open")}</button></a></div>`;
      result.appendChild(card);
      state.lastResult = null;
      watchReading(data.id, (doc) => {
        if (!card.isConnected) return;
        if (doc.status === "complete") { card.replaceWith(readCard(doc)); }
        else if (doc.status === "failed") { $("#readState", card).innerHTML = t("filed_pending"); }
      });
    } else {
      state.lastResult = data;
      result.appendChild(resultCard(data));
    }
  } catch (err) {
    const b = err.body || {};
    if (b.id) status.innerHTML = `${t("filed_pending")} <a href="#/doc/${esc(b.id)}">${t("open")}</a>`;
    else status.textContent = `${t("failed")}: ${err.message}${b.stage ? ` (${b.stage})` : ""}`;
  } finally {
    btn.disabled = false; if (up) up.disabled = false;
  }
}

/** The archive: every document, newest first; typing in the field filters it. */
async function archiveView() {
  if (gate()) return;
  view.innerHTML = `
    <div class="h2row"><h2>${t("tab_archive")}${state.space ? ` · ${esc(state.space.name)}` : ""}</h2><a class="pill hi" href="#/spending">${icon("receipt")} ${t("spending")}</a></div>
    <div class="search"><input id="q" type="search" placeholder="${esc(t("search_ph"))}" autocomplete="off"></div>
    <div id="list" class="empty">${t("loading")}</div>`;
  const q = $("#q");
  let timer, seq = 0;
  const show = async () => {
    const v = q.value.trim(), my = ++seq;
    // A stale response must not overwrite a newer query's list.
    const el = $("#list"); if (!el) return;
    if (!v) { await fillList("#list", "/api/recent", t("nothing_yet"), "camera", () => my === seq); return; }
    await fillList("#list", `/api/search?q=${encodeURIComponent(v)}`, t("no_matches"), "search", () => my === seq);
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(show, 250); });
  await show();
}

async function actionsView() {
  if (gate()) return;
  view.innerHTML = `<h2>${t("needs_action")}</h2><div id="list" class="empty">${t("loading")}</div>`;
  await fillList("#list", "/api/actions", t("nothing_due"), "circle-check");
}

function emptyState(iconName, text) {
  return `<div class="emptystate">${icon(iconName)}<div>${text}</div></div>`;
}

async function fillList(sel, path, emptyText, emptyIcon = "inbox", stillWanted = () => true) {
  const el = $(sel);
  try {
    const { documents } = await api(path);
    if (!stillWanted() || !el.isConnected) return;
    el.innerHTML = "";
    el.className = documents.length ? "" : "empty";
    if (!documents.length) { el.innerHTML = emptyState(emptyIcon, emptyText); return; }
    for (const d of documents) el.appendChild(listCard(d));
  } catch (err) {
    el.className = "empty";
    el.textContent = err.status === 503 ? t("no_db") : t("could_not_load", err.message);
  }
}

async function docView(id) {
  if (gate()) return;
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let d, expense;
  try { ({ document: d, expense } = await api(`/api/documents/${id}`)); }
  catch (err) { view.innerHTML = `<div class="empty">${err.status === 404 ? t("not_found") : esc(err.message)}</div>`; return; }
  if (READING.has(d.status)) {
    view.innerHTML = `<div class="card"><h3>${icon("refresh-cw")} ${t("reading_now")}</h3><div class="meta">${t("reading_doc")}</div>${photoBlock(d.id, Boolean(d.storage_key))}
      <div class="footer-actions"><a href="#/archive" class="meta">${t("back_archive")}</a></div></div>`;
    watchReading(id, () => docView(id));
    return;
  }

  const x = d.extracted_data || {};
  const F = t("fields");
  const fields = [
    [F.type, tt("doctype", d.document_type)], [F.date, d.document_date],
    [F.amount, x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null],
    [F.due, x.due_date], [F.reference, x.reference_number],
    [F.categories, Array.isArray(x.categories) ? x.categories.map((c) => tt("category", c)).join(state.lang === "ja" ? "・" : ", ") : null],
    ...Object.entries(x).filter(([k]) => !["amount", "currency", "due_date", "reference_number", "categories"].includes(k)).map(([k, v]) => [k, String(v)]),
  ].filter(([, v]) => v != null && v !== "");
  // Operational rows: useful to the operator, noise to a household member.
  const tech = [
    [F.status, d.status + (d.error ? ` — ${d.error}` : "")],
    [F.lang, d.lang ? t("lang_name")[d.lang] || d.lang : null],
    [F.cost, state.admin && d.cost_usd != null ? costLine({ total_usd: Number(d.cost_usd), total_jpy: Number(d.cost_usd) * 150, tokens: (d.llm_input_tokens || 0) + (d.llm_output_tokens || 0) }) : null],
    [F.model, state.admin ? d.extraction_model : null], [F.ocr, state.admin ? d.ocr_provider : null],
    [t("version"), d.extraction_version ? `v${d.extraction_version}${d.extracted_at ? " · " + String(d.extracted_at).slice(0, 10) : ""}` : null],
  ].filter(([, v]) => v != null && v !== "");
  const tables = Array.isArray(x.tables) ? x.tables : [];
  const fieldRows = fields.filter(([k]) => k !== "tables");


  view.innerHTML = `
    <div class="card">
      <h3>${esc(d.title)}</h3>
      <div class="meta">${esc(d.summary || "")}</div>
      ${actionLine(d)}
      <div class="keep" id="keep">${retentionLabel(d.retention)} <span class="meta">— ${esc(d.retention_reason || "")}</span></div>
      ${decideButtons(d.id)}
      ${handlingPills(d.handling)}
      ${d.status === "failed" ? `<div class="notice">${t("filed_pending")}</div>` : ""}
      ${photoBlock(d.id, Boolean(d.storage_key))}
      <div id="sender">${senderBlock(d)}</div>
      <dl class="fields">${fieldRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${expenseBlock(expense)}
      ${tables.length ? `<details><summary class="meta">${t("tables")} · ${tables.length}</summary>${tables.map(tableHtml).join("")}</details>` : ""}
      <details><summary class="meta">${t("ocr_text")}</summary><pre>${esc(d.ocr_text || "")}</pre></details>
      <details><summary class="meta">${t("details")}</summary><dl class="fields">${tech.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details>
      <div class="status" id="reStatus"></div>
      <div class="footer-actions">
        <a href="#/archive" class="meta">${t("back_archive")}</a>
        <span class="row">
          <button class="small" id="re">${icon("refresh-cw")} ${t("reanalyze")}</button>
          <button class="small danger" id="del">${icon("trash-2")} ${t("delete")}</button>
        </span>
      </div>
    </div>`;
  wireDecide(view, d.id);
  wireSender(view, d);
  $("#re").addEventListener("click", async () => {
    const b = $("#re"), st = $("#reStatus");
    b.disabled = true; st.textContent = t("reanalyzing");
    try { await postJson(`/api/documents/${d.id}/reanalyze`, {}); st.textContent = t("reanalyzed"); docView(d.id); }
    catch (err) { b.disabled = false; st.textContent = t("reanalyze_failed", err.message); }
  });
  $("#del").addEventListener("click", async () => {
    if (!confirm(t("confirm_delete"))) return;
    try { await api(`/api/documents/${d.id}`, { method: "DELETE" }); location.hash = "#/archive"; }
    catch (err) { alert(t("delete_failed", err.message)); }
  });
}

// ---------- spaces ----------

async function spacesView() {
  if (gate()) return;
  view.innerHTML = `<p class="sub">${t("archives_hint")}</p><h2>${t("your_archive")}</h2><div id="mine" class="empty">${t("loading")}</div>
    <h2>${t("shared_with_you")}</h2><div id="shared" class="empty">${t("loading")}</div>`;
  try {
    const { current, spaces } = await api("/api/spaces");
    const card = (s) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row" style="justify-content:space-between">
        <div><h3 style="display:inline">${esc(s.name)}</h3> ${s.id === current ? `<span class="pill warn">${t("current")}</span>` : ""}
          <div class="meta">${s.role === "owner" ? t("members_n", s.member_count) : t("shared_by", esc(s.owner_name || ""))}</div></div>
        <div class="row">${s.id !== current ? `<button class="small" data-select="${s.id}">${t("switch_to")}</button>` : ""}<a href="#/space/${s.id}" style="text-decoration:none"><button class="small">${icon("settings")} ${t("settings")}</button></a></div></div>`;
      return el;
    };
    const mine = $("#mine"), shared = $("#shared");
    mine.innerHTML = ""; shared.innerHTML = ""; mine.className = ""; shared.className = "";
    for (const s of spaces) (s.role === "owner" ? mine : shared).appendChild(card(s));
    if (!shared.children.length) { shared.className = "empty"; shared.textContent = t("no_shared"); }
    view.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", async () => {
      await api(`/api/spaces/${b.dataset.select}/select`, { method: "POST" });
      await whoami(); state.lastResult = null; spacesView();
    }));
  } catch (err) { $("#mine").textContent = err.status === 503 ? t("no_db") : t("could_not_load", err.message); }
}

async function spaceView(id) {
  if (gate()) return;
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let s, members, invites;
  try {
    const all = await api("/api/spaces");
    s = all.spaces.find((x) => x.id === id);
    if (!s) throw Object.assign(new Error("not found"), { status: 404 });
    ({ members } = await api(`/api/spaces/${id}/members`));
    ({ invites } = await api(`/api/spaces/${id}/invites`));
  } catch (err) { view.innerHTML = `<div class="empty">${err.status === 404 ? t("not_found") : esc(err.message)}</div>`; return; }
  const isOwner = s.role === "owner";
  const meId = members.find((m) => m.role === "owner" && isOwner)?.user_id;

  view.innerHTML = `
    <div class="card">
      <h3>${esc(s.name)} <span class="pill">${isOwner ? t("owner") : t("member")}</span></h3>
      ${isOwner ? "" : `<div class="meta">${t("shared_by", esc(s.owner_name || ""))}</div>`}
      ${isOwner ? `<div class="search" style="margin-top:10px"><input id="rename" maxlength="60" value="${esc(s.name)}"><button class="small" id="renameBtn">${t("save")}</button></div>` : ""}
    </div>
    <div class="card">
      <h3>${t("members")} · ${t("members_n", members.length)}</h3>
      <div id="members"></div>
      ${!isOwner ? `<div class="footer-actions"><span></span><button class="small danger" id="leave">${t("leave")}</button></div>` : ""}
    </div>
    <div class="card">
      <h3>${t("invites")}</h3>
      <div class="meta">${t("invite_hint")}</div>
      <div id="invites"></div>
      <div class="decide"><button id="mkInvite">${t("create_invite")}</button></div>
    </div>`;

  const ml = $("#members");
  for (const m of members) {
    const row = document.createElement("div"); row.className = "allowrow";
    const canRemove = isOwner && m.role !== "owner";
    row.innerHTML = `<div class="t"><b>${esc(m.name || m.email)}</b> <span class="pill">${m.role === "owner" ? t("owner") : t("member")}</span><div class="meta">${esc(m.email)}</div></div>
      ${canRemove ? `<button class="small danger" data-rm="${m.user_id}" data-name="${esc(m.name || m.email)}" title="${t("remove")}">${icon("trash-2")}</button>` : ""}`;
    ml.appendChild(row);
  }
  ml.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("confirm_remove", b.dataset.name))) return;
    try { await api(`/api/spaces/${id}/members/${b.dataset.rm}`, { method: "DELETE" }); spaceView(id); } catch (err) { alert(err.message); }
  }));
  const leave = $("#leave");
  if (leave) leave.addEventListener("click", async () => {
    if (!confirm(t("confirm_leave"))) return;
    try {
      const me = state.user ? members.find((m) => m.email === state.user.email) : null;
      if (me) await api(`/api/spaces/${id}/members/${me.user_id}`, { method: "DELETE" });
      await whoami(); location.hash = "#/spaces";
    } catch (err) { alert(err.message); }
  });
  const rb = $("#renameBtn");
  if (rb) rb.addEventListener("click", async () => {
    const name = $("#rename").value.trim(); if (!name) return;
    try { await postJson(`/api/spaces/${id}`, { name }, "PATCH"); await whoami(); spaceView(id); } catch (err) { alert(t("save_failed", err.message)); }
  });

  const il = $("#invites");
  let qrcodeMod = null;
  const drawQr = async (el, text) => {
    qrcodeMod = qrcodeMod || (await import("/vendor/qrcode.mjs")).default;
    const qr = qrcodeMod(0, "M"); qr.addData(text); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  };
  const renderInvites = () => {
    il.innerHTML = "";
    invites.forEach((inv, i) => {
      const row = document.createElement("div"); row.className = "invite";
      row.innerHTML = `<div class="row" style="justify-content:space-between;padding:6px 0">
          <span class="meta">${t("expires", inv.expires_at.slice(0, 10))} · ${t("uses", inv.uses, inv.max_uses)}</span>
          <span class="row"><button class="small" data-qr="${esc(inv.url)}">${icon("qr-code")}</button><button class="small" data-copy="${esc(inv.url)}">${t("copy")}</button>${isOwner ? `<button class="small danger" data-revoke="${inv.id}">${icon("trash-2")}</button>` : ""}</span>
        </div><div class="qr" hidden></div>`;
      il.appendChild(row);
      if (i === 0) { const q = row.querySelector(".qr"); q.hidden = false; drawQr(q, inv.url); }
    });
    il.querySelectorAll("[data-qr]").forEach((b) => b.addEventListener("click", () => {
      const q = b.closest(".invite").querySelector(".qr");
      q.hidden = !q.hidden; if (!q.hidden && !q.firstChild) drawQr(q, b.dataset.qr);
    }));
    il.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = t("copied"); setTimeout(() => (b.textContent = t("copy")), 1500); }
      catch { prompt("", b.dataset.copy); }
    }));
    il.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => {
      try { await api(`/api/spaces/${id}/invites/${b.dataset.revoke}`, { method: "DELETE" }); invites = invites.filter((i) => i.id !== b.dataset.revoke); renderInvites(); } catch (err) { alert(err.message); }
    }));
  };
  renderInvites();
  $("#mkInvite").addEventListener("click", async () => {
    try { const inv = await api(`/api/spaces/${id}/invites`, { method: "POST" }); invites.unshift({ id: "new-" + Date.now(), url: inv.url, expires_at: inv.expires_at, uses: 0, max_uses: 10 }); renderInvites(); }
    catch (err) { alert(err.message); }
  });
}

async function joinView(token) {
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let inv;
  try { ({ invite: inv } = await api(`/api/invites/${token}`)); }
  catch { view.innerHTML = `<div class="card"><h3>${t("join_title")}</h3><div class="notice">${t("invite_invalid")}</div></div>`; return; }
  if (!inv.valid) { view.innerHTML = `<div class="card"><h3>${t("join_title")}</h3><div class="notice">${t("invite_expired")}</div></div>`; return; }
  view.innerHTML = `<div class="card"><h3>${t("join_title")}</h3><p>${t("join_desc", inv.space_name, inv.inviter_name)}</p>
    <div class="decide">${state.signedIn ? `<button id="joinBtn">${t("join")}</button>` : `<span id="joinSignin">${gsiButton("/auth/login?next=" + encodeURIComponent("/join/" + token))}</span>`}</div></div>`;
  const jb = $("#joinBtn");
  if (jb) jb.addEventListener("click", async () => {
    try {
      const { space } = await api(`/api/invites/${token}/accept`, { method: "POST" });
      try { localStorage.removeItem("pa_pending_invite"); } catch {}
      await whoami(); state.lastResult = null;
      view.innerHTML = `<div class="card"><h3>${t("join_title")}</h3><p>${t("joined", esc(space.name))}</p><div class="decide"><a href="#/archive"><button>${t("tab_archive")}</button></a></div></div>`;
    } catch (err) { view.querySelector(".card").insertAdjacentHTML("beforeend", `<div class="notice">${err.status === 410 ? t("invite_expired") : t("invite_invalid")}</div>`); }
  });
  const js = $("#joinSignin");
  if (js) js.addEventListener("click", () => { try { localStorage.setItem("pa_pending_invite", token); } catch {} });
}

// ---------- admin: the allow-list ----------

async function adminView() {
  if (gate()) return;
  if (!state.admin) { view.innerHTML = `<div class="empty">${t("not_found")}</div>`; return; }
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let data, costs = null;
  try { data = await api("/api/admin/allowlist"); } catch (err) { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  try { costs = await api("/api/costs"); } catch {}
  const F = t("fields");
  view.innerHTML = `
    <div class="card">
      <h3>${t("admin_title")}</h3>
      <div class="meta">${t("admin_hint")}</div>
      <div class="meta" style="margin-top:6px">${esc(t("admin_bootstrap", data.bootstrap || "—"))}</div>
      <div id="rows" class="allow"></div>
      <div class="addrow">
        <input id="newEntry" class="full" placeholder="${esc(t("entry"))}" autocomplete="off" inputmode="email">
        <input id="newNote" placeholder="${esc(t("note"))}">
        <select id="newRole"><option value="member">${t("role_member")}</option><option value="admin">${t("role_admin")}</option></select>
        <button class="small full" id="addBtn">${icon("plus")} ${t("add")}</button>
      </div>
    </div>
    ${costs ? `<div class="card"><h3>${t("costs_title")}</h3>
      <span class="stat"><b>${esc(costs.attempts)}</b>${t("attempts")}</span>
      <span class="stat"><b>¥${Math.round(costs.total_usd * 150).toLocaleString()}</b>${t("spend")}</span>
      <span class="stat"><b>¥${(costs.avg_usd_per_scan * 150).toFixed(1)}</b>${t("avg_scan")}</span>
      <div class="meta" style="margin-top:8px">US$${Number(costs.total_usd).toFixed(3)} · ${costs.users} user(s) · since ${costs.since ? String(costs.since).slice(0, 10) : "—"}</div>
      ${Array.isArray(costs.by_user) && costs.by_user.length ? `<h3 style="margin-top:14px">${t("by_user")}</h3>
      ${costs.by_user.map((u) => `<div class="allowrow"><div><b>${esc(u.name || u.email)}</b>${u.name ? `<div class="meta">${esc(u.email)}</div>` : ""}
        <div class="meta">${esc(u.attempts)} ${t("attempts")}${u.reanalyses ? ` · ${t("reanalyses_n", u.reanalyses)}` : ""} · ¥${(u.total_usd * 150 / Math.max(1, u.attempts)).toFixed(1)} ${t("avg_scan")} · ${u.last_at ? String(u.last_at).slice(0, 10) : ""}</div></div>
        <div style="text-align:right"><b>¥${Math.round(u.total_usd * 150).toLocaleString()}</b><div class="meta">¥${Math.round(u.month_usd * 150).toLocaleString()} ${t("this_month")}</div></div></div>`).join("")}` : ""}</div>` : ""}`;
  const rows = $("#rows");
  for (const e of data.entries) {
    const row = document.createElement("div");
    row.className = "allowrow";
    row.innerHTML = `<div class="t"><b>${esc(e.email)}</b>${e.role === "admin" ? ` <span class="pill">${t("role_admin")}</span>` : ""}
        <div class="meta">${[e.note, String(e.created_at).slice(0, 10)].filter(Boolean).map(esc).join(" · ")}</div></div>
      <button class="small danger" data-rm="${esc(e.email)}" title="${t("remove")}">${icon("trash-2")}</button>`;
    rows.appendChild(row);
  }
  rows.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("confirm_remove_entry", b.dataset.rm))) return;
    try { await api(`/api/admin/allowlist/${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" }); adminView(); } catch (err) { alert(err.message); }
  }));
  $("#addBtn").addEventListener("click", async () => {
    const email = $("#newEntry").value.trim(); if (!email) return;
    try { await postJson("/api/admin/allowlist", { email, role: $("#newRole").value, note: $("#newNote").value.trim() || null }); adminView(); }
    catch (err) { alert(t("save_failed", err.message)); }
  });
}

// ---------- share (QR) ----------

async function shareView() {
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  // Loaded on demand: the encoder is only needed here.
  const { default: qrcode } = await import("/vendor/qrcode.mjs");
  const render = (el, text) => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
    el.querySelector("svg").setAttribute("role", "img");
    el.querySelector("svg").setAttribute("aria-label", text);
  };
  const appUrl = location.origin + "/";
  const canInvite = Boolean(state.space) && canCall();

  view.innerHTML = `
    <div class="card share">
      <h3>${t("share_app")}</h3>
      <div class="meta">${t("share_app_hint")}</div>
      <div class="qr" id="qrApp"></div>
      <div class="url">${esc(appUrl)}</div>
      <div class="decide">
        <button data-copy="${esc(appUrl)}">${icon("copy")} ${t("copy")}</button>
        ${navigator.share ? `<button data-share="${esc(appUrl)}">${icon("link")} ${t("share_native")}</button>` : ""}
        <button id="printBtn">${icon("printer")} ${t("print")}</button>
      </div>
    </div>
    ${canInvite ? `
    <div class="card share">
      <h3>${t("share_space", esc(state.space.name), state.space.role === "owner")}</h3>
      <div class="meta">${t("share_space_hint")}</div>
      <div class="qr" id="qrInvite"></div>
      <div class="url" id="inviteUrl"></div>
      <div class="decide" id="inviteActions"><button id="mkQr">${t("create_invite")}</button></div>
    </div>` : ""}`;

  render($("#qrApp"), appUrl);
  wireShareButtons(view);
  $("#printBtn").addEventListener("click", () => window.print());

  const mk = $("#mkQr");
  if (mk) mk.addEventListener("click", async () => {
    mk.disabled = true;
    try {
      const inv = await api(`/api/spaces/${state.space.id}/invites`, { method: "POST" });
      render($("#qrInvite"), inv.url);
      $("#inviteUrl").textContent = inv.url;
      $("#inviteActions").innerHTML = `<button data-copy="${esc(inv.url)}">${t("copy")}</button>${navigator.share ? `<button data-share="${esc(inv.url)}">${t("share_native")}</button>` : ""}<span class="meta">${t("expires", inv.expires_at.slice(0, 10))}</span>`;
      wireShareButtons($("#inviteActions"));
    } catch (err) { mk.disabled = false; alert(err.message); }
  });
}

function wireShareButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); const o = b.textContent; b.textContent = t("copied"); setTimeout(() => (b.textContent = o), 1500); }
    catch { prompt("", b.dataset.copy); }
  }));
  root.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.share({ title: "Paper Archive", url: b.dataset.share }); } catch {}
  }));
}

// ---------- cards ----------

const retentionLabel = (r) => t("retention")[r] || esc(r || "");

function dueInfo(dateStr) {
  if (!dateStr) return { text: "", cls: "" };
  const days = Math.round((new Date(dateStr) - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return { text: t("overdue", -days), cls: "overdue" };
  if (days === 0) return { text: t("due_today"), cls: "overdue" };
  if (days <= 7) return { text: t("due_in", days), cls: "warn" };
  return { text: t("due_on", dateStr), cls: "" };
}

function actionLine(d) {
  if (!d.action_required) return "";
  const due = dueInfo(d.action_date);
  const kind = d.action_type ? tt("action", d.action_type) : t("action_required");
  return `<div class="action">${icon("triangle-alert")} ${esc(kind)}${due.text ? " · " + due.text : ""}</div>`;
}

function costLine(c) {
  if (!c) return "";
  const jpy = Math.round(c.total_jpy * 10) / 10;
  return t("cost", jpy, c.total_usd.toFixed(3), c.tokens || 0);
}

function listCard(d) {
  const a = document.createElement("a");
  a.className = "card"; a.href = `#/doc/${d.id}`;
  const due = d.action_required ? dueInfo(d.action_date) : null;
  const meta = [d.issuer, d.document_date].filter(Boolean).join(" · ");
  const jpy = state.admin && d.cost_usd != null ? Math.round(Number(d.cost_usd) * 150 * 10) / 10 : null;
  a.innerHTML = `
    <h3>${esc(d.title || "(untitled)")}</h3>
    <div class="row">
      <span class="meta">${esc(meta)}</span>
      ${due ? `<span class="pill ${due.cls}">${esc(d.action_type ? tt("action", d.action_type) : t("action_required"))}${due.text ? " · " + due.text : ""}</span>` : ""}
      ${d.retention === "unsure" ? `<span class="pill warn">${t("pill_review")}</span>` : ""}
      ${d.status === "failed" ? `<span class="pill">${t("pill_failed")}</span>` : READING.has(d.status) ? `<span class="pill">${t("pill_reading")}</span>` : ""}
      ${Array.isArray(d.handling) && d.handling.includes("expense") ? `<span class="pill">${tt("handling", "expense")}</span>` : ""}
      ${jpy != null ? `<span class="pill">${t("cost_short", jpy)}</span>` : ""}
    </div>`;
  return a;
}

function resultCard(data) {
  const x = data.extraction, el = document.createElement("div");
  el.className = "card";
  const money = x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null;
  const drive = data.id ? photoBlock(data.id, true) : data.dry ? `<div class="meta">${t("dry_hint")}</div>` : "";
  const ex = x.expense && Array.isArray(x.handling) && x.handling.includes("expense") ? x.expense : null;
  el.innerHTML = `
    <h3>${esc(x.title)}</h3>
    <div class="meta">${esc([tt("doctype", x.document_type), x.issuer, x.document_date, money].filter(Boolean).join(" · "))}</div>
    <div class="meta">${esc(x.summary)}</div>
    ${handlingPills(x.handling)}
    ${actionLine(x)}
    <div class="keep" id="keep">${retentionLabel(x.retention)} <span class="meta">— ${esc(x.retention_reason)}</span></div>
    ${data.id ? decideButtons(data.id) : ""}
    ${ex ? `<div class="meta">${icon("receipt")} ${esc([tt("expense_kind", ex.expense_kind), ex.merchant_key || ex.merchant, ex.total != null ? fmtMoney(ex.total, ex.currency) : null, ex.items.length ? t("items_n", ex.items.length) : null].filter(Boolean).join(" · "))}</div>` : ""}
    ${data.id ? `<div id="sender">${senderBlock({ id: data.id, issuer: x.issuer })}</div>` : ""}
    ${drive}
    ${state.admin && data.cost ? `<div class="meta">${t("fields").cost}: ${esc(costLine(data.cost))}</div>` : ""}
    <details><summary class="meta">${t("ocr", data.ocr.pages, data.ocr.chars)} · ${data.id ? `<a href="#/doc/${data.id}">${t("open")}</a>` : t("not_indexed")}</summary><pre>${esc(data.ocr.text)}</pre></details>`;
  if (data.id) { wireDecide(el, data.id); wireSender(el, { id: data.id, issuer: x.issuer }); }
  return el;
}

// ---------- v2 helpers: labels, sender, expenses, spending ----------

const fmtMoney = (n, cur = "JPY") => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return cur === "JPY" || !cur ? `¥${Math.round(v).toLocaleString()}` : `${cur} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const READING = new Set(["pending", "ocr", "extracting"]);
/** Polls one document until it is read (or fails). Stops when the caller's view is gone. */
function watchReading(id, onChange) {
  let tries = 0;
  const tick = async () => {
    if (location.hash !== "#/" && !location.hash.startsWith(`#/doc/${id}`)) return;
    try {
      const { document: d, expense } = await api(`/api/documents/${id}`);
      if (!READING.has(d.status)) { onChange(d, expense); return; }
    } catch { return; }
    if (++tries < 60) setTimeout(tick, tries < 10 ? 3000 : 6000);
  };
  setTimeout(tick, 3000);
}
/** A finished reading, shown on the camera screen in place of the "saved" card. */
function readCard(d) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<h3>${esc(d.title)}</h3>
    <div class="meta">${esc([tt("doctype", d.document_type), d.issuer, d.document_date].filter(Boolean).join(" · "))}</div>
    <div class="meta">${esc(d.summary || "")}</div>
    ${handlingPills(d.handling)}
    ${actionLine(d)}
    <div class="keep" id="keep">${retentionLabel(d.retention)} <span class="meta">— ${esc(d.retention_reason || "")}</span></div>
    ${decideButtons(d.id)}
    <div id="sender">${senderBlock(d)}</div>
    <div class="decide"><a href="#/doc/${esc(d.id)}"><button>${t("open")}</button></a></div>`;
  wireDecide(el, d.id); wireSender(el, d);
  return el;
}

/** iPhone Safari cannot prompt to install a web app; the one-line hint says where the menu is. */
function iosHint() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  let dismissed = false; try { dismissed = Boolean(localStorage.getItem("pa_ios_hint")); } catch {}
  if (!ios || standalone || dismissed) return "";
  return `<div class="ioshint" id="iosHint">${icon("plus")} <span>${t("ios_hint")}</span><button class="link" aria-label="${esc(t("dismiss"))}">${icon("x")}</button></div>`;
}

/** The stored photo: a thumbnail that opens the original (same-origin, so the session cookie applies). */
function photoBlock(id, stored) {
  if (!stored) return `<div class="meta">${t("photo_missing")}</div>`;
  const src = `/api/documents/${id}/file`;
  return `<a class="photo" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="" loading="lazy"><span>${icon("image")} ${t("view_photo")}</span></a>`;
}

function handlingPills(h) {
  if (!Array.isArray(h) || !h.length) return "";
  return `<div class="row tags">${h.map((k) => `<span class="pill ${k === "todo" ? "warn" : ""}">${esc(tt("handling", k))}</span>`).join("")}</div>`;
}

/** The sender line: printed issuer with an edit pencil, or — when the paper does not say — a prompt. */
function senderBlock(d) {
  const F = t("fields");
  if (d.issuer) return `<div class="sender"><span class="meta">${esc(F.issuer)}</span> <b>${esc(d.issuer)}</b> <button class="link" data-edit-sender aria-label="${esc(t("edit"))}">${icon("pencil")}</button></div>`;
  return `<div class="sender ask"><div class="meta">${t("from_missing")}</div>${senderForm(d.issuer)}</div>`;
}
function senderForm(current) {
  return `<form class="from" data-sender-form><input name="issuer" maxlength="60" placeholder="${esc(t("from_ph"))}" value="${esc(current || "")}" aria-label="${esc(t("who_from"))}"><button class="small" type="submit">${t("save")}</button></form><div class="chips" data-chips></div>`;
}
function wireSender(root, d) {
  const box = root.querySelector("#sender"); if (!box) return;
  const arm = () => {
    const edit = box.querySelector("[data-edit-sender]");
    if (edit) edit.addEventListener("click", () => { box.innerHTML = `<div class="sender ask"><div class="meta">${t("who_from")}</div>${senderForm(d.issuer)}</div>`; arm(); });
    const form = box.querySelector("[data-sender-form]");
    if (!form) return;
    const input = form.querySelector("input");
    // Chips: senders this archive already knows, so a name is typed once.
    api("/api/issuers").then(({ issuers }) => {
      const chips = box.querySelector("[data-chips]"); if (!chips) return;
      chips.innerHTML = issuers.slice(0, 8).map((i) => `<button type="button" class="chip" data-v="${esc(i.issuer_key)}"><span>${esc(i.issuer_key)}</span></button>`).join("");
      chips.querySelectorAll("[data-v]").forEach((c) => c.addEventListener("click", () => { input.value = c.dataset.v; form.requestSubmit(); }));
    }).catch(() => {});
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const issuer = input.value.trim(); if (!issuer) return;
      form.querySelector("button").disabled = true;
      try { await postJson(`/api/documents/${d.id}/issuer`, { issuer }, "PATCH"); d.issuer = issuer; box.innerHTML = senderBlock(d); arm(); }
      catch (err) { form.querySelector("button").disabled = false; alert(t("save_failed", err.message)); }
    });
  };
  arm();
}

function expenseBlock(e) {
  if (!e) return "";
  const rows = [
    [t("kind"), tt("expense_kind", e.expense_kind)], [t("merchant"), e.merchant_key || e.merchant],
    [t("total"), e.total != null ? fmtMoney(e.total, e.currency) : null], [t("tax"), e.tax != null ? fmtMoney(e.tax, e.currency) : null],
    [t("payment"), e.payment_method ? tt("payment_method", e.payment_method) : null],
  ].filter(([, v]) => v != null && v !== "");
  const items = e.items || [];
  return `<div class="expense">
    <div class="meta">${icon("receipt")} ${t("expense")}</div>
    <dl class="fields">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${items.length ? `<details open class="items"><summary class="meta">${t("items")} · ${t("items_n", items.length)}</summary><table>${items.map((it) =>
      `<tr><td>${esc(it.name)}${it.quantity && it.quantity !== 1 ? ` <span class="meta">×${esc(it.quantity)}</span>` : ""}</td><td class="meta">${esc(tt("item_category", it.category))}</td><td class="num">${it.amount != null ? fmtMoney(it.amount, e.currency) : ""}</td></tr>`).join("")}</table></details>` : ""}
  </div>`;
}

function tableHtml(tb) {
  const cols = Array.isArray(tb.columns) ? tb.columns : [], rows = Array.isArray(tb.rows) ? tb.rows : [];
  return `<div class="tbl">${tb.title ? `<div class="meta">${esc(tb.title)}</div>` : ""}<table>${cols.length ? `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` : ""}${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
}

function barList(rows, labelOf, amountOf, cur) {
  if (!rows.length) return `<div class="meta">—</div>`;
  const max = Math.max(...rows.map(amountOf), 1);
  return `<div class="bars">${rows.map((r) => `<div class="bar"><span class="l">${esc(labelOf(r))}</span><span class="v">${fmtMoney(amountOf(r), cur)}</span><span class="track"><span class="fill" style="width:${Math.max(2, Math.round(amountOf(r) / max * 100))}%"></span></span></div>`).join("")}</div>`;
}

/** Spending: one month of the expense ledger. */
async function spendingView(month) {
  if (gate()) return;
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let s;
  try { s = await api(`/api/spending${month ? `?month=${month}` : ""}`); }
  catch (err) { view.innerHTML = `<div class="empty">${err.status === 503 ? t("no_db") : t("could_not_load", err.message)}</div>`; return; }
  const months = s.months.map((m) => m.month);
  const cur = months.indexOf(s.month);
  const prev = cur >= 0 ? months[cur + 1] : months.find((m) => m < s.month);
  const next = cur > 0 ? months[cur - 1] : null;
  const label = (m) => state.lang === "ja" ? `${m.slice(0, 4)}年${Number(m.slice(5))}月` : new Date(m + "-01T00:00:00").toLocaleDateString("en", { month: "long", year: "numeric" });
  const currency = (s.expenses[0] && s.expenses[0].currency) || "JPY";
  view.innerHTML = `
    <div class="monthnav">
      <a class="chip icon-only" href="#/spending/${prev || s.month}" ${prev ? "" : 'aria-disabled="true"'}>${icon("chevron-left")}</a>
      <h2>${esc(label(s.month))}</h2>
      <a class="chip icon-only" href="#/spending/${next || s.month}" ${next ? "" : 'aria-disabled="true"'}>${icon("chevron-right")}</a>
    </div>
    <div class="card">
      <div class="hero">${fmtMoney(s.total, currency)}</div>
      <div class="meta">${t("spending")} · ${t("expenses_n", s.expenses.length)}${s.tax ? ` · ${t("tax")} ${fmtMoney(s.tax, currency)}` : ""}</div>
    </div>
    ${s.expenses.length ? `
    <div class="card"><h3>${t("by_category")}</h3>${barList(s.by_category, (r) => tt("item_category", r.category), (r) => r.amount, currency)}</div>
    <div class="card"><h3>${t("by_kind")}</h3>${barList(s.by_kind, (r) => tt("expense_kind", r.kind), (r) => r.amount, currency)}</div>
    <div class="card"><h3>${t("by_merchant")}</h3>${barList(s.by_merchant, (r) => r.merchant, (r) => r.amount, currency)}</div>
    <h2>${t("receipts")}</h2>
    ${s.expenses.map((e) => `<a class="card" href="#/doc/${e.id}"><h3>${esc(e.merchant || e.title)}</h3><div class="row"><span class="meta">${esc([e.spent_on, tt("expense_kind", e.expense_kind), e.items ? t("items_n", e.items) : null].filter(Boolean).join(" · "))}</span><span class="pill">${fmtMoney(e.total, e.currency)}</span></div></a>`).join("")}`
    : emptyState("receipt", t("no_spending"))}`;
}

function decideButtons(id) {
  const D = t("decide");
  return `<div class="decide" data-id="${esc(id)}">
    <button data-r="digital_sufficient">${D.digital_sufficient}</button>
    <button data-r="keep_temporarily">${D.keep_temporarily}</button>
    <button data-r="keep_original">${D.keep_original}</button>
  </div>`;
}

function wireDecide(root, id) {
  root.querySelectorAll(".decide button[data-r]").forEach((b) => b.addEventListener("click", async () => {
    const retention = b.dataset.r;
    b.disabled = true;
    try {
      await postJson(`/api/documents/${id}/retention`, { retention, reason: state.lang === "ja" ? "ユーザーが決定" : "Decided by user" }, "PATCH");
      const keep = root.querySelector("#keep") || root.querySelector(".keep");
      if (keep) keep.textContent = t("retention")[retention];
      const box = root.querySelector(".decide"); if (box) box.remove();
    } catch (err) { b.disabled = false; alert(t("save_failed", err.message)); }
  }));
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }

// ---------- boot ----------

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
applyLang();
paintIcons();
(async () => {
  // A pasted invite link is /join/<token>; turn it into the hash route.
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{20,64})$/);
  if (m) { history.replaceState(null, "", "/"); location.hash = `#/join/${m[1]}`; }
  await whoami();
  // Came back from Google sign-in with an invite pending → finish joining.
  let pending = null;
  try { pending = localStorage.getItem("pa_pending_invite"); } catch {}
  if (pending && state.signedIn) location.hash = `#/join/${pending}`;
  await route();
})();
