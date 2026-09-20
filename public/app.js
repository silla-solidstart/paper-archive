/* Paper Archive — one file, no build step.
 *
 * Screens (hash routes): #/ scan · #/recent · #/actions · #/search · #/doc/:id
 * Auth: session cookie from Sign in with Google, or a bearer token pasted into
 * the disclosure on the scan screen (pre-sign-in tester mode).
 * Language: EN / 日本語 — UI strings here, and the model writes the summary
 * and retention reason in the same language (sent as X-Lang).
 */
"use strict";

const MAX_EDGE = 2200;      // downscale long edge before upload — see downscale()
const JPEG_QUALITY = 0.85;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view"), who = $("#who"), fileInput = $("#file"), langBtn = $("#lang");

const state = { signedIn: false, user: null, token: "", lastResult: null, lang: "en" };
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
    not_filed: "Not filed — sign in with Google to file scans to your Drive.",
    filing_failed: "Indexed, but filing to Drive failed. Nothing is kept server-side, so re-scan to file it.",
    reconnect: (href) => `Google access has lapsed — <a href="${href}">sign in again</a>, then re-scan to file it.`,
    not_in_drive: "Not in Drive — re-scan to file it.",
    open_drive: "Open in Google Drive",
    retention: { digital_sufficient: "◎ Digital copy likely sufficient", keep_temporarily: "◍ Keep temporarily", keep_original: "◑ Keep original", unsure: "⚠ Unsure — your call" },
    decide: { digital_sufficient: "Digital is enough", keep_temporarily: "Keep for now", keep_original: "Keep original" },
    action_required: "Action required", action: { payment: "payment", appointment: "appointment", renewal: "renewal", signature: "signature", response: "response", cancellation: "cancellation" },
    overdue: (d) => `overdue by ${d}d`, due_today: "due today", due_in: (d) => `due in ${d}d`, due_on: (date) => `due ${date}`,
    pill_review: "review", pill_not_in_drive: "not in Drive",
    recent: "Recent", needs_action: "Needs action", nothing_yet: "Nothing scanned yet.", nothing_due: "Nothing needs action. 🎉",
    search_ph: "固定資産税, Tokyo Gas, 上越市…", search_hint: "Search OCR text, titles and issuers. Japanese works.", no_matches: "No matches.",
    loading: "Loading…", could_not_load: (m) => `Could not load: ${m}`, no_db: "No database configured yet.",
    gate: "Sign in with Google, or paste an API token on the Scan screen.", not_found: "Not found.",
    ocr: (pages, chars) => `OCR (${pages} page${pages === 1 ? "" : "s"}, ${chars} chars)`, ocr_text: "OCR text",
    indexed: "indexed", not_indexed: "not indexed", open: "open", back_recent: "← Recent", delete: "Delete",
    confirm_delete: "Remove this document from the archive? The Drive file is moved to trash.",
    delete_failed: (m) => `Delete failed: ${m}`, save_failed: (m) => `Could not save: ${m}`,
    cost: (jpy, usd, tokens) => `Cost ≈ ¥${jpy} (US$${usd}) · ${tokens.toLocaleString()} tokens`,
    cost_short: (jpy) => `≈ ¥${jpy}`,
    fields: { type: "Type", issuer: "Issuer", date: "Date", amount: "Amount", due: "Due", reference: "Reference", categories: "Categories", status: "Status", model: "Model", ocr: "OCR", lang: "Interpreted in", cost: "Cost" },
    doctype: { tax_notice: "Tax notice", government_notice: "Government notice", utility_bill: "Utility bill", insurance: "Insurance", bank_statement: "Bank statement", invoice: "Invoice", receipt: "Receipt", school_letter: "School letter", medical: "Medical", contract: "Contract", subscription: "Subscription", advertisement: "Advertisement", other: "Other" },
    lang_name: { en: "English", ja: "日本語" },
  },
  ja: {
    tab_scan: "スキャン", tab_recent: "最近", tab_actions: "要対応", tab_search: "検索",
    sub: "郵便物をスキャン → 内容と必要な対応を把握 → 原本を残すか判断",
    scan: "スキャン", signin: "Googleでログイン", signout: "ログアウト",
    token_toggle: "APIトークンを使う",
    preparing: "準備中…", reading: (kb) => `読み取り中 ${kb} KB…（OCR → 解析）`,
    failed: "失敗", need_auth: "ログインするか、下にAPIトークンを入力してください。",
    not_filed: "未保存 — Googleでログインするとドライブに保存されます。",
    filing_failed: "索引には登録されましたが、ドライブへの保存に失敗しました。サーバーには保存されないため、再スキャンしてください。",
    reconnect: (href) => `Googleへのアクセスが切れました。<a href="${href}">再ログイン</a>してから再スキャンしてください。`,
    not_in_drive: "ドライブ未保存 — 再スキャンしてください。",
    open_drive: "Googleドライブで開く",
    retention: { digital_sufficient: "◎ デジタル控えで十分", keep_temporarily: "◍ 一時的に保管", keep_original: "◑ 原本を保管", unsure: "⚠ 判断が必要" },
    decide: { digital_sufficient: "デジタルで十分", keep_temporarily: "とりあえず保管", keep_original: "原本を保管" },
    action_required: "要対応", action: { payment: "支払い", appointment: "予約", renewal: "更新", signature: "署名", response: "返信", cancellation: "解約" },
    overdue: (d) => `期限超過 ${d}日`, due_today: "本日期限", due_in: (d) => `あと${d}日`, due_on: (date) => `期限 ${date}`,
    pill_review: "要確認", pill_not_in_drive: "未保存",
    recent: "最近", needs_action: "要対応", nothing_yet: "まだスキャンがありません。", nothing_due: "対応が必要なものはありません 🎉",
    search_ph: "固定資産税、東京ガス、上越市…", search_hint: "OCRテキスト・タイトル・発行元を検索します。", no_matches: "該当なし。",
    loading: "読み込み中…", could_not_load: (m) => `読み込めませんでした: ${m}`, no_db: "データベースが未設定です。",
    gate: "Googleでログインするか、スキャン画面でAPIトークンを入力してください。", not_found: "見つかりません。",
    ocr: (pages, chars) => `OCR（${pages}ページ、${chars}文字）`, ocr_text: "OCRテキスト",
    indexed: "登録済み", not_indexed: "未登録", open: "開く", back_recent: "← 最近", delete: "削除",
    confirm_delete: "この書類をアーカイブから削除しますか？ドライブのファイルはゴミ箱に移動します。",
    delete_failed: (m) => `削除に失敗: ${m}`, save_failed: (m) => `保存できませんでした: ${m}`,
    cost: (jpy, usd, tokens) => `費用 約¥${jpy}（US$${usd}）・${tokens.toLocaleString()}トークン`,
    cost_short: (jpy) => `約¥${jpy}`,
    fields: { type: "種類", issuer: "発行元", date: "日付", amount: "金額", due: "期限", reference: "番号", categories: "分類", status: "状態", model: "モデル", ocr: "OCR", lang: "解釈の言語", cost: "費用" },
    doctype: { tax_notice: "納税通知書", government_notice: "行政からの通知", utility_bill: "公共料金", insurance: "保険", bank_statement: "銀行明細", invoice: "請求書", receipt: "領収書", school_letter: "学校からのお知らせ", medical: "医療", contract: "契約", subscription: "定期契約", advertisement: "広告", other: "その他" },
    lang_name: { en: "English", ja: "日本語" },
  },
};
const t = (key, ...args) => { const v = STR[state.lang][key]; return typeof v === "function" ? v(...args) : v; };
const tt = (group, key) => (STR[state.lang][group] || {})[key] ?? key;

function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll(".tabs a").forEach((a) => { a.lastChild.textContent = t("tab_" + a.dataset.tab); });
  langBtn.textContent = state.lang === "en" ? "日本語" : "EN";
  langBtn.title = t("lang_name")[state.lang === "en" ? "ja" : "en"];
}
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

function canCall() { return state.signedIn || Boolean(state.token); }

async function whoami() {
  try {
    const { user } = await api("/api/me");
    state.signedIn = true; state.user = user;
  } catch { state.signedIn = false; state.user = null; }
  renderWho();
}

function renderWho() {
  who.innerHTML = state.signedIn
    ? `<span>${esc(state.user.name || state.user.email)}</span><a href="/auth/logout">${t("signout")}</a>`
    : `<a class="signin" href="/auth/login">${t("signin")}</a>`;
}

// ---------- router ----------

const routes = [
  [/^#\/?$/, scanView],
  [/^#\/recent$/, recentView],
  [/^#\/actions$/, actionsView],
  [/^#\/search$/, searchView],
  [/^#\/doc\/([0-9a-f-]{36})$/, docView],
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
  if (tokenEl) tokenEl.addEventListener("change", () => {
    state.token = tokenEl.value.trim();
    try { localStorage.setItem("pa_token", state.token); } catch {}
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
  // Phone JPEGs are 3–8 MB; Claude takes ~5 MB per image and the Worker cannot
  // resize. The canvas also turns iOS HEIC into JPEG, which the upstreams need.
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
  view.innerHTML = `<h2>${t("recent")}</h2><div id="list" class="empty">${t("loading")}</div>`;
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
      ${driveLink ? `<div class="drive">📁 <a href="${driveLink}" target="_blank" rel="noopener">${t("open_drive")}</a></div>`
                  : d.status === "failed" ? `<div class="notice">${t("not_in_drive")}</div>` : ""}
      <dl class="fields">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <details><summary class="meta">${t("ocr_text")}</summary><pre>${esc(d.ocr_text || "")}</pre></details>
      <div class="footer-actions">
        <a href="#/recent" class="meta">${t("back_recent")}</a>
        <button class="small danger" id="del">${t("delete")}</button>
      </div>
    </div>`;
  wireDecide(view, d.id);
  $("#del").addEventListener("click", async () => {
    if (!confirm(t("confirm_delete"))) return;
    try { await api(`/api/documents/${d.id}`, { method: "DELETE" }); location.hash = "#/recent"; }
    catch (err) { alert(t("delete_failed", err.message)); }
  });
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
  return `<div class="action">⚠ ${esc(kind)}${due.text ? " · " + due.text : ""}</div>`;
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
  if (data.filed) drive = `<div class="drive">📁 <a href="${esc(data.filed.link)}" target="_blank" rel="noopener">${esc(data.filed.path)}</a></div>`;
  else if (data.filing_error === "reconnect_google") drive = `<div class="notice">${t("reconnect", "/auth/login")}</div>`;
  else if (data.filing_error) drive = `<div class="notice">${t("filing_failed")}</div>`;
  else if (!state.signedIn) drive = `<div class="meta">${t("not_filed")}</div>`;
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
  root.querySelectorAll(".decide button").forEach((b) => b.addEventListener("click", async () => {
    const retention = b.dataset.r;
    b.disabled = true;
    try {
      await api(`/api/documents/${id}/retention`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retention, reason: state.lang === "ja" ? "ユーザーが決定" : "Decided by user" }),
      });
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
(async () => { await whoami(); await route(); })();
