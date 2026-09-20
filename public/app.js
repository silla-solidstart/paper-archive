/* Paper Archive — one file, no build step.
 *
 * Screens (hash routes): #/ scan · #/recent · #/actions · #/search · #/doc/:id
 *                        #/spaces · #/space/:id · #/join/:token
 * Auth: session cookie from Sign in with Google, or a bearer token pasted into
 * the disclosure on the scan screen (pre-sign-in tester mode).
 * Language: EN / 日本語 — UI strings here, and the model writes the summary
 * and retention reason in the same language (sent as X-Lang).
 * Spaces: everything you see is the current space; files go to the space
 * owner's Google Drive.
 */
"use strict";

const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.85;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view"), who = $("#who"), fileInput = $("#file"), langBtn = $("#lang"), spaceBtn = $("#space"), shareBtn = $("#shareBtn"), adminBtn = $("#adminBtn");

// Lucide icons (public/icons.js). icon(name) returns inline SVG that follows currentColor.
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${(window.LUCIDE || {})[name] || ""}</svg>`;
function paintIcons(root = document) { root.querySelectorAll("i[data-icon]").forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon); }); }

const state = { signedIn: false, user: null, space: null, admin: false, token: "", lastResult: null, lang: "en" };
try { state.token = localStorage.getItem("pa_token") || ""; } catch {}
try {
  const saved = localStorage.getItem("pa_lang");
  state.lang = saved === "ja" || saved === "en" ? saved : (/^ja\b/i.test(navigator.language) ? "ja" : "en");
} catch { state.lang = /^ja\b/i.test(navigator.language) ? "ja" : "en"; }

// ---------- i18n ----------

const STR = {
  en: {
    tab_scan: "Scan", tab_recent: "Recent", tab_actions: "Actions", tab_search: "Search",
    sub: "Scan mail → know what it wants → know whether to keep the original.",
    scan: "Scan", signin: "Sign in with Google", signout: "Sign out",
    token_toggle: "Use an API token instead",
    preparing: "Preparing…", reading: (kb) => `Reading ${kb} KB… (OCR, then understanding)`,
    failed: "Failed", need_auth: "Sign in, or paste an API token below.",
    not_filed: "Not filed — the space owner hasn't connected Google Drive.",
    not_filed_self: "Not filed — sign in with Google to file scans to your Drive.",
    filing_failed: "Indexed, but filing to Drive failed. Nothing is kept server-side, so re-scan to file it.",
    reconnect: (href) => `The space owner's Google access has lapsed — they need to <a href="${href}">sign in again</a>; then re-scan to file it.`,
    not_in_drive: "Not in Drive — re-scan to file it.",
    open_drive: "Open in Google Drive",
    retention: { digital_sufficient: "◎ Digital copy likely sufficient", keep_temporarily: "◍ Keep temporarily", keep_original: "◑ Keep original", unsure: "⚠ Unsure — your call" },
    decide: { digital_sufficient: "Digital is enough", keep_temporarily: "Keep for now", keep_original: "Keep original" },
    action_required: "Action required", action: { payment: "payment", appointment: "appointment", renewal: "renewal", signature: "signature", response: "response", cancellation: "cancellation" },
    overdue: (d) => `overdue by ${d}d`, due_today: "due today", due_in: (d) => `due in ${d}d`, due_on: (date) => `due ${date}`,
    pill_review: "review", pill_not_in_drive: "not in Drive",
    recent: "Recent", needs_action: "Needs action", nothing_yet: "Nothing scanned in this space yet.", nothing_due: "Nothing needs action.",
    search_ph: "固定資産税, Tokyo Gas, 上越市…", search_hint: "Search OCR text, titles and issuers. Japanese works.", no_matches: "No matches.",
    loading: "Loading…", could_not_load: (m) => `Could not load: ${m}`, no_db: "No database configured yet.",
    gate: "Sign in with Google, or paste an API token on the Scan screen.", not_found: "Not found.",
    ocr: (pages, chars) => `OCR (${pages} page${pages === 1 ? "" : "s"}, ${chars} chars)`, ocr_text: "OCR text",
    indexed: "indexed", not_indexed: "not indexed", open: "open", back_recent: "← Recent", delete: "Delete",
    confirm_delete: "Remove this document from the archive? The Drive file is moved to trash.",
    delete_failed: (m) => `Delete failed: ${m}`, save_failed: (m) => `Could not save: ${m}`,
    cost: (jpy, usd, tokens) => `Cost ≈ ¥${jpy} (US$${usd}) · ${tokens.toLocaleString()} tokens`,
    cost_short: (jpy) => `≈ ¥${jpy}`,
    fields: { type: "Type", issuer: "Issuer", date: "Date", amount: "Amount", due: "Due", reference: "Reference", categories: "Categories", status: "Status", model: "Model", ocr: "OCR", lang: "Interpreted in", cost: "Cost", scanned_by: "Scanned by" },
    doctype: { tax_notice: "Tax notice", government_notice: "Government notice", utility_bill: "Utility bill", insurance: "Insurance", bank_statement: "Bank statement", invoice: "Invoice", receipt: "Receipt", school_letter: "School letter", medical: "Medical", contract: "Contract", subscription: "Subscription", advertisement: "Advertisement", other: "Other" },
    lang_name: { en: "English", ja: "日本語" },
    // spaces
    spaces: "Spaces", space: "Space", your_spaces: "Your spaces", current: "current", owner: "owner", member: "member",
    members_n: (n) => `${n} member${n === 1 ? "" : "s"}`, new_space: "New space", space_name_ph: "Space name, e.g. Family, 田中家, Office",
    create: "Create", settings: "Settings", rename: "Rename", save: "Save", members: "Members", remove: "Remove", leave: "Leave space",
    confirm_leave: "Leave this space? You will no longer see its documents.", confirm_remove: (n) => `Remove ${n} from this space?`,
    invites: "Invite people", invite_hint: "Anyone with the link can join within 7 days (up to 10 people). They sign in with Google to accept.",
    create_invite: "Create invite link", copy: "Copy link", copied: "Copied", revoke: "Revoke", expires: (d) => `expires ${d}`, uses: (u, m) => `${u}/${m} used`,
    where_files_go: (name) => `Files scanned into this space are stored in the space owner's Google Drive, under Paper Archive / ${name}.`,
    join_title: "Join a space", join_desc: (space, by) => `You've been invited to <b>${esc(space)}</b>${by ? ` by ${esc(by)}` : ""}.`,
    join: "Join", join_signin: "Sign in with Google to join", joined: (name) => `You're in ${name}.`, invite_invalid: "This invite link is invalid.", invite_expired: "This invite link has expired or was used up.",
    switch_to: "Switch",
    share: "Share", share_app: "Share the app", share_app_hint: "Scan to open Paper Archive. Print it and put it where the mail lands.",
    share_space: (n) => `Invite to ${n}`, share_space_hint: "Scan to join this space. The link works for 7 days, up to 10 people; they sign in with Google.",
    share_native: "Share…", print: "Print", open_link: "Open",
    admin: "Admin", admin_title: "Who can sign in", admin_hint: "Invite-only. Add an email, or @domain for everyone at a domain. Removal takes effect on their next request.",
    admin_bootstrap: (list) => `Always allowed (config): ${list}`, entry: "Email or @domain", role: "Role", note: "Note (optional)", added: "Added", add: "Add",
    role_admin: "admin", role_member: "member", confirm_remove_entry: (e) => `Remove ${e} from the allow-list?`,
    costs_title: "Costs, all users", attempts: "scans", spend: "spend", avg_scan: "avg / scan",
  },
  ja: {
    tab_scan: "スキャン", tab_recent: "最近", tab_actions: "要対応", tab_search: "検索",
    sub: "郵便物をスキャン → 内容と必要な対応を把握 → 原本を残すか判断",
    scan: "スキャン", signin: "Googleでログイン", signout: "ログアウト",
    token_toggle: "APIトークンを使う",
    preparing: "準備中…", reading: (kb) => `読み取り中 ${kb} KB…（OCR → 解析）`,
    failed: "失敗", need_auth: "ログインするか、下にAPIトークンを入力してください。",
    not_filed: "未保存 — スペースの所有者がGoogleドライブを接続していません。",
    not_filed_self: "未保存 — Googleでログインするとドライブに保存されます。",
    filing_failed: "索引には登録されましたが、ドライブへの保存に失敗しました。サーバーには保存されないため、再スキャンしてください。",
    reconnect: (href) => `スペース所有者のGoogleアクセスが切れています。所有者が<a href="${href}">再ログイン</a>した後、再スキャンしてください。`,
    not_in_drive: "ドライブ未保存 — 再スキャンしてください。",
    open_drive: "Googleドライブで開く",
    retention: { digital_sufficient: "◎ デジタル控えで十分", keep_temporarily: "◍ 一時的に保管", keep_original: "◑ 原本を保管", unsure: "⚠ 判断が必要" },
    decide: { digital_sufficient: "デジタルで十分", keep_temporarily: "とりあえず保管", keep_original: "原本を保管" },
    action_required: "要対応", action: { payment: "支払い", appointment: "予約", renewal: "更新", signature: "署名", response: "返信", cancellation: "解約" },
    overdue: (d) => `期限超過 ${d}日`, due_today: "本日期限", due_in: (d) => `あと${d}日`, due_on: (date) => `期限 ${date}`,
    pill_review: "要確認", pill_not_in_drive: "未保存",
    recent: "最近", needs_action: "要対応", nothing_yet: "このスペースにはまだスキャンがありません。", nothing_due: "対応が必要なものはありません。",
    search_ph: "固定資産税、東京ガス、上越市…", search_hint: "OCRテキスト・タイトル・発行元を検索します。", no_matches: "該当なし。",
    loading: "読み込み中…", could_not_load: (m) => `読み込めませんでした: ${m}`, no_db: "データベースが未設定です。",
    gate: "Googleでログインするか、スキャン画面でAPIトークンを入力してください。", not_found: "見つかりません。",
    ocr: (pages, chars) => `OCR（${pages}ページ、${chars}文字）`, ocr_text: "OCRテキスト",
    indexed: "登録済み", not_indexed: "未登録", open: "開く", back_recent: "← 最近", delete: "削除",
    confirm_delete: "この書類をアーカイブから削除しますか？ドライブのファイルはゴミ箱に移動します。",
    delete_failed: (m) => `削除に失敗: ${m}`, save_failed: (m) => `保存できませんでした: ${m}`,
    cost: (jpy, usd, tokens) => `費用 約¥${jpy}（US$${usd}）・${tokens.toLocaleString()}トークン`,
    cost_short: (jpy) => `約¥${jpy}`,
    fields: { type: "種類", issuer: "発行元", date: "日付", amount: "金額", due: "期限", reference: "番号", categories: "分類", status: "状態", model: "モデル", ocr: "OCR", lang: "解釈の言語", cost: "費用", scanned_by: "スキャン者" },
    doctype: { tax_notice: "納税通知書", government_notice: "行政からの通知", utility_bill: "公共料金", insurance: "保険", bank_statement: "銀行明細", invoice: "請求書", receipt: "領収書", school_letter: "学校からのお知らせ", medical: "医療", contract: "契約", subscription: "定期契約", advertisement: "広告", other: "その他" },
    lang_name: { en: "English", ja: "日本語" },
    spaces: "スペース", space: "スペース", your_spaces: "あなたのスペース", current: "現在", owner: "所有者", member: "メンバー",
    members_n: (n) => `${n}人`, new_space: "新しいスペース", space_name_ph: "スペース名（例：田中家、自宅、事務所）",
    create: "作成", settings: "設定", rename: "名前を変更", save: "保存", members: "メンバー", remove: "削除", leave: "スペースを退出",
    confirm_leave: "このスペースを退出しますか？書類は見えなくなります。", confirm_remove: (n) => `${n} をこのスペースから削除しますか？`,
    invites: "メンバーを招待", invite_hint: "リンクを知っている人は7日以内に参加できます（最大10人）。参加にはGoogleログインが必要です。",
    create_invite: "招待リンクを作成", copy: "リンクをコピー", copied: "コピーしました", revoke: "無効化", expires: (d) => `有効期限 ${d}`, uses: (u, m) => `${u}/${m} 使用`,
    where_files_go: (name) => `このスペースでスキャンした書類は、所有者のGoogleドライブ内「Paper Archive / ${name}」に保存されます。`,
    join_title: "スペースに参加", join_desc: (space, by) => `<b>${esc(space)}</b> に招待されています${by ? `（${esc(by)} から）` : ""}。`,
    join: "参加する", join_signin: "Googleでログインして参加", joined: (name) => `${name} に参加しました。`, invite_invalid: "この招待リンクは無効です。", invite_expired: "この招待リンクは期限切れか、使用回数の上限に達しています。",
    switch_to: "切替",
    share: "共有", share_app: "アプリを共有", share_app_hint: "スキャンするとPaper Archiveが開きます。印刷して郵便物の置き場に貼っておくと便利です。",
    share_space: (n) => `「${n}」に招待`, share_space_hint: "スキャンするとこのスペースに参加できます。リンクは7日間・最大10人まで有効。参加にはGoogleログインが必要です。",
    share_native: "共有…", print: "印刷", open_link: "開く",
    admin: "管理", admin_title: "ログインできる人", admin_hint: "招待制です。メールアドレス、またはドメイン全体なら @ドメイン を追加します。削除は次のリクエストから反映されます。",
    admin_bootstrap: (list) => `常に許可（設定）: ${list}`, entry: "メールまたは @ドメイン", role: "権限", note: "メモ（任意）", added: "追加日", add: "追加",
    role_admin: "管理者", role_member: "メンバー", confirm_remove_entry: (e) => `${e} を許可リストから削除しますか？`,
    costs_title: "費用（全ユーザー）", attempts: "スキャン", spend: "支出", avg_scan: "1件あたり",
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
  adminBtn.querySelector("span").textContent = t("admin");
  paintIcons();
  renderSpaceBtn();
}
shareBtn.addEventListener("click", () => { location.hash = "#/share"; });
adminBtn.addEventListener("click", () => { location.hash = "#/admin"; });
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
  if (!state.signedIn && state.token) {
    // The bearer token is the operator: admin, in its own space.
    try { const { spaces, current } = await api("/api/spaces"); state.space = spaces.find((s) => s.id === current) || null; state.admin = true; } catch { state.space = null; }
  }
  renderWho(); renderSpaceBtn();
}

function renderWho() {
  who.innerHTML = state.signedIn
    ? `<span>${esc(state.user.name || state.user.email)}</span><a href="/auth/logout">${t("signout")}</a>`
    : `<a class="signin" href="/auth/login">${t("signin")}</a>`;
}
function renderSpaceBtn() {
  spaceBtn.hidden = !state.space;
  if (state.space) spaceBtn.querySelector("span").textContent = state.space.name;
  adminBtn.hidden = !state.admin;
}
spaceBtn.addEventListener("click", () => { location.hash = "#/spaces"; });

// ---------- router ----------

const routes = [
  [/^#\/?$/, scanView],
  [/^#\/recent$/, recentView],
  [/^#\/actions$/, actionsView],
  [/^#\/search$/, searchView],
  [/^#\/doc\/([0-9a-f-]{36})$/, docView],
  [/^#\/spaces$/, spacesView],
  [/^#\/space\/([0-9a-f-]{36})$/, spaceView],
  [/^#\/join\/([A-Za-z0-9_-]{20,64})$/, joinView],
  [/^#\/share$/, shareView],
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
    <p class="sub">${t("sub")}</p>
    <button class="scan" id="scanBtn">${t("scan")}</button>
    <details class="token" id="tokenBox" ${state.signedIn ? "hidden" : ""}>
      <summary>${t("token_toggle")}</summary>
      <input id="token" type="password" placeholder="APP_BEARER_TOKEN" autocomplete="off" value="${esc(state.token)}">
    </details>
    <div class="status" id="status"></div>
    <div id="result"></div>`;
  $("#scanBtn").addEventListener("click", () => fileInput.click());
  const tokenEl = $("#token");
  if (tokenEl) tokenEl.addEventListener("change", async () => {
    state.token = tokenEl.value.trim();
    try { localStorage.setItem("pa_token", state.token); } catch {}
    await whoami();
  });
  if (state.lastResult) $("#result").appendChild(resultCard(state.lastResult));
}

fileInput.addEventListener("change", async (e) => {
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
  const btn = $("#scanBtn"), status = $("#status"), result = $("#result");
  if (!canCall()) { status.textContent = t("need_auth"); return; }
  btn.disabled = true;
  try {
    status.textContent = t("preparing");
    const { blob, type } = await downscale(file);
    status.textContent = t("reading", (blob.size / 1024).toFixed(0));
    const data = await api("/api/process", {
      method: "POST",
      headers: { "Content-Type": type, "X-Filename": encodeURIComponent(file.name || "scan") },
      body: blob,
    });
    status.textContent = "";
    state.lastResult = data;
    result.innerHTML = "";
    result.appendChild(resultCard(data));
  } catch (err) {
    const stage = err.body && err.body.stage ? ` (${err.body.stage})` : "";
    status.textContent = `${t("failed")}: ${err.message}${stage}`;
  } finally {
    btn.disabled = false;
  }
}

async function recentView() {
  if (gate()) return;
  view.innerHTML = `<h2>${t("recent")}${state.space ? ` · ${esc(state.space.name)}` : ""}</h2><div id="list" class="empty">${t("loading")}</div>`;
  await fillList("#list", "/api/recent", t("nothing_yet"));
}

async function actionsView() {
  if (gate()) return;
  view.innerHTML = `<h2>${t("needs_action")}</h2><div id="list" class="empty">${t("loading")}</div>`;
  await fillList("#list", "/api/actions", t("nothing_due"));
}

async function searchView() {
  if (gate()) return;
  view.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="${esc(t("search_ph"))}" autofocus></div>
    <div id="list" class="empty">${t("search_hint")}</div>`;
  const q = $("#q");
  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = q.value.trim();
      if (!v) { $("#list").className = "empty"; $("#list").textContent = t("search_hint"); return; }
      fillList("#list", `/api/search?q=${encodeURIComponent(v)}`, t("no_matches"));
    }, 250);
  });
}

async function fillList(sel, path, emptyText) {
  const el = $(sel);
  try {
    const { documents } = await api(path);
    el.innerHTML = "";
    el.className = documents.length ? "" : "empty";
    if (!documents.length) { el.textContent = emptyText; return; }
    for (const d of documents) el.appendChild(listCard(d));
  } catch (err) {
    el.className = "empty";
    el.textContent = err.status === 503 ? t("no_db") : t("could_not_load", err.message);
  }
}

async function docView(id) {
  if (gate()) return;
  view.innerHTML = `<div class="empty">${t("loading")}</div>`;
  let d;
  try { ({ document: d } = await api(`/api/documents/${id}`)); }
  catch (err) { view.innerHTML = `<div class="empty">${err.status === 404 ? t("not_found") : esc(err.message)}</div>`; return; }

  const x = d.extracted_data || {};
  const F = t("fields");
  const fields = [
    [F.type, tt("doctype", d.document_type)], [F.issuer, d.issuer], [F.date, d.document_date],
    [F.amount, x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null],
    [F.due, x.due_date], [F.reference, x.reference_number],
    [F.categories, Array.isArray(x.categories) ? x.categories.join(", ") : null],
    ...Object.entries(x).filter(([k]) => !["amount", "currency", "due_date", "reference_number", "categories"].includes(k)).map(([k, v]) => [k, String(v)]),
    [F.status, d.status + (d.error ? ` — ${d.error}` : "")],
    [F.lang, d.lang ? t("lang_name")[d.lang] || d.lang : null],
    [F.cost, d.cost_usd != null ? costLine({ total_usd: Number(d.cost_usd), total_jpy: Number(d.cost_usd) * 150, tokens: (d.llm_input_tokens || 0) + (d.llm_output_tokens || 0) }) : null],
    [F.model, d.extraction_model], [F.ocr, d.ocr_provider],
  ].filter(([, v]) => v != null && v !== "");

  const driveLink = d.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(d.drive_file_id)}/view` : null;

  view.innerHTML = `
    <div class="card">
      <h3>${esc(d.title)}</h3>
      <div class="meta">${esc(d.summary || "")}</div>
      ${actionLine(d)}
      <div class="keep" id="keep">${retentionLabel(d.retention)} <span class="meta">— ${esc(d.retention_reason || "")}</span></div>
      ${decideButtons(d.id)}
      ${driveLink ? `<div class="drive">${icon("folder-open")} <a href="${driveLink}" target="_blank" rel="noopener">${t("open_drive")}</a></div>`
                  : d.status === "failed" ? `<div class="notice">${t("not_in_drive")}</div>` : ""}
      <dl class="fields">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <details><summary class="meta">${t("ocr_text")}</summary><pre>${esc(d.ocr_text || "")}</pre></details>
      <div class="footer-actions">
        <a href="#/recent" class="meta">${t("back_recent")}</a>
        <button class="small danger" id="del">${icon("trash-2")} ${t("delete")}</button>
      </div>
    </div>`;
  wireDecide(view, d.id);
  $("#del").addEventListener("click", async () => {
    if (!confirm(t("confirm_delete"))) return;
    try { await api(`/api/documents/${d.id}`, { method: "DELETE" }); location.hash = "#/recent"; }
    catch (err) { alert(t("delete_failed", err.message)); }
  });
}

// ---------- spaces ----------

async function spacesView() {
  if (gate()) return;
  view.innerHTML = `<h2>${t("your_spaces")}</h2><div id="list" class="empty">${t("loading")}</div>
    <div class="card">
      <h3>${t("new_space")}</h3>
      <div class="search"><input id="newName" maxlength="60" placeholder="${esc(t("space_name_ph"))}"><button class="small" id="createBtn">${t("create")}</button></div>
    </div>`;
  const list = $("#list");
  try {
    const { current, spaces } = await api("/api/spaces");
    list.className = ""; list.innerHTML = "";
    for (const s of spaces) {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row" style="justify-content:space-between">
        <div><h3 style="display:inline">${esc(s.name)}</h3> <span class="pill">${s.role === "owner" ? t("owner") : t("member")}</span> ${s.id === current ? `<span class="pill warn">${t("current")}</span>` : ""}
          <div class="meta">${t("members_n", s.member_count)}</div></div>
        <div class="row">${s.id !== current ? `<button class="small" data-select="${s.id}">${t("switch_to")}</button>` : ""}<a class="small" href="#/space/${s.id}" style="text-decoration:none"><button class="small">${t("settings")}</button></a></div></div>`;
      list.appendChild(el);
    }
    list.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", async () => {
      await api(`/api/spaces/${b.dataset.select}/select`, { method: "POST" });
      await whoami(); state.lastResult = null; spacesView();
    }));
  } catch (err) { list.textContent = err.status === 503 ? t("no_db") : t("could_not_load", err.message); }
  $("#createBtn").addEventListener("click", async () => {
    const name = $("#newName").value.trim();
    if (!name) return;
    try { await postJson("/api/spaces", { name }); await whoami(); state.lastResult = null; spacesView(); }
    catch (err) { alert(t("save_failed", err.message)); }
  });
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
      <div class="meta">${t("where_files_go", esc(s.name))}</div>
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
    const row = document.createElement("div"); row.className = "row"; row.style.justifyContent = "space-between"; row.style.padding = "6px 0";
    const canRemove = isOwner && m.role !== "owner";
    row.innerHTML = `<span>${esc(m.name || m.email)} <span class="meta">${esc(m.email)}</span> <span class="pill">${m.role === "owner" ? t("owner") : t("member")}</span></span>
      ${canRemove ? `<button class="small danger" data-rm="${m.user_id}" data-name="${esc(m.name || m.email)}">${t("remove")}</button>` : ""}`;
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
  const renderInvites = () => {
    il.innerHTML = "";
    for (const inv of invites) {
      const row = document.createElement("div"); row.className = "row"; row.style.justifyContent = "space-between"; row.style.padding = "6px 0";
      row.innerHTML = `<span class="meta">${t("expires", inv.expires_at.slice(0, 10))} · ${t("uses", inv.uses, inv.max_uses)}</span>
        <span class="row"><button class="small" data-copy="${esc(inv.url)}">${t("copy")}</button>${isOwner ? `<button class="small danger" data-revoke="${inv.id}">${t("revoke")}</button>` : ""}</span>`;
      il.appendChild(row);
    }
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
    <div class="decide">${state.signedIn ? `<button id="joinBtn">${t("join")}</button>` : `<a class="signin" href="/auth/login" id="joinSignin">${t("join_signin")}</a>`}</div></div>`;
  const jb = $("#joinBtn");
  if (jb) jb.addEventListener("click", async () => {
    try {
      const { space } = await api(`/api/invites/${token}/accept`, { method: "POST" });
      try { localStorage.removeItem("pa_pending_invite"); } catch {}
      await whoami(); state.lastResult = null;
      view.innerHTML = `<div class="card"><h3>${t("join_title")}</h3><p>${t("joined", esc(space.name))}</p><div class="decide"><a href="#/recent"><button>${t("tab_recent")}</button></a></div></div>`;
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
      <table class="admin" style="margin-top:10px"><thead><tr><th>${t("entry")}</th><th>${t("role")}</th><th>${t("note")}</th><th>${t("added")}</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table>
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
      <div class="meta" style="margin-top:8px">US$${Number(costs.total_usd).toFixed(3)} · ${costs.users} user(s) · since ${costs.since ? String(costs.since).slice(0, 10) : "—"}</div></div>` : ""}`;
  const rows = $("#rows");
  for (const e of data.entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(e.email)}</td><td>${e.role === "admin" ? t("role_admin") : t("role_member")}</td><td class="meta">${esc(e.note || "")}</td><td class="meta">${esc(String(e.created_at).slice(0, 10))}</td>
      <td><button class="small danger" data-rm="${esc(e.email)}" title="${t("remove")}">${icon("trash-2")}</button></td>`;
    rows.appendChild(tr);
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
      <h3>${t("share_space", esc(state.space.name))}</h3>
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
  const jpy = d.cost_usd != null ? Math.round(Number(d.cost_usd) * 150 * 10) / 10 : null;
  a.innerHTML = `
    <h3>${esc(d.title || "(untitled)")}</h3>
    <div class="row">
      <span class="meta">${esc(meta)}</span>
      ${due ? `<span class="pill ${due.cls}">${esc(d.action_type ? tt("action", d.action_type) : t("action_required"))}${due.text ? " · " + due.text : ""}</span>` : ""}
      ${d.retention === "unsure" ? `<span class="pill warn">${t("pill_review")}</span>` : ""}
      ${d.status === "failed" ? `<span class="pill">${t("pill_not_in_drive")}</span>` : ""}
      ${jpy != null ? `<span class="pill">${t("cost_short", jpy)}</span>` : ""}
    </div>`;
  return a;
}

function resultCard(data) {
  const x = data.extraction, el = document.createElement("div");
  el.className = "card";
  const money = x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null;
  let drive = "";
  if (data.filed) drive = `<div class="drive">${icon("folder-open")} <a href="${esc(data.filed.link)}" target="_blank" rel="noopener">${esc(data.filed.path)}</a></div>`;
  else if (data.filing_error === "reconnect_google") drive = `<div class="notice">${t("reconnect", "/auth/login")}</div>`;
  else if (data.filing_error === "owner_no_drive") drive = `<div class="meta">${state.signedIn ? t("not_filed") : t("not_filed_self")}</div>`;
  else if (data.filing_error) drive = `<div class="notice">${t("filing_failed")}</div>`;
  el.innerHTML = `
    <h3>${esc(x.title)}</h3>
    <div class="meta">${esc([tt("doctype", x.document_type), x.issuer, x.document_date, money].filter(Boolean).join(" · "))}</div>
    <div class="meta">${esc(x.summary)}</div>
    ${actionLine(x)}
    <div class="keep" id="keep">${retentionLabel(x.retention)} <span class="meta">— ${esc(x.retention_reason)}</span></div>
    ${data.id ? decideButtons(data.id) : ""}
    ${drive}
    ${data.cost ? `<div class="meta">${esc(costLine(data.cost))}</div>` : ""}
    <details><summary class="meta">${t("ocr", data.ocr.pages, data.ocr.chars)} · ${data.id ? `<a href="#/doc/${data.id}">${t("open")}</a>` : t("not_indexed")}</summary><pre>${esc(data.ocr.text)}</pre></details>`;
  if (data.id) wireDecide(el, data.id);
  return el;
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
