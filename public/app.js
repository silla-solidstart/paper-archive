/* Paper Archive — one file, no build step.
 *
 * Screens (hash routes): #/ scan · #/recent · #/actions · #/search · #/doc/:id
 * Auth: session cookie from Sign in with Google, or a bearer token pasted into
 * the disclosure on the scan screen (pre-sign-in tester mode).
 */
"use strict";

const MAX_EDGE = 2200;      // downscale long edge before upload — see process()
const JPEG_QUALITY = 0.85;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view"), who = $("#who"), fileInput = $("#file");

const state = { signedIn: false, user: null, token: "", lastResult: null };
try { state.token = localStorage.getItem("pa_token") || ""; } catch {}

// ---------- api ----------

function authHeaders(extra = {}) {
  const h = { ...extra };
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
    ? `<span>${esc(state.user.name || state.user.email)}</span><a href="/auth/logout">Sign out</a>`
    : `<a class="signin" href="/auth/login">Sign in with Google</a>`;
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
      document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", hash.startsWith(a.getAttribute("href")) && (a.getAttribute("href") !== "#/" || hash === "#/")));
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
  view.innerHTML = `<div class="empty">Sign in with Google, or paste an API token on the Scan screen.</div>`;
  return true;
}

async function scanView() {
  view.innerHTML = `
    <p class="sub">Scan mail → know what it wants → know whether to keep the original.</p>
    <button class="scan" id="scanBtn">Scan</button>
    <details class="token" id="tokenBox" ${state.signedIn ? "hidden" : ""}>
      <summary>Use an API token instead</summary>
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
  if (!location.hash || location.hash === "#/") await process(file);
  else { location.hash = "#/"; await new Promise((r) => setTimeout(r, 0)); await process(file); }
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
  if (!canCall()) { status.textContent = "Sign in, or paste an API token below."; return; }
  btn.disabled = true;
  try {
    status.textContent = "Preparing…";
    const { blob, type } = await downscale(file);
    status.textContent = `Reading ${(blob.size / 1024).toFixed(0)} KB… (OCR, then understanding)`;
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
    status.textContent = `Failed: ${err.message}${stage}`;
  } finally {
    btn.disabled = false;
  }
}

async function recentView() {
  if (gate()) return;
  view.innerHTML = `<h2>Recent</h2><div id="list" class="empty">Loading…</div>`;
  await fillList("#list", "/api/recent", "Nothing scanned yet.");
}

async function actionsView() {
  if (gate()) return;
  view.innerHTML = `<h2>Needs action</h2><div id="list" class="empty">Loading…</div>`;
  await fillList("#list", "/api/actions", "Nothing needs action. 🎉");
}

async function searchView() {
  if (gate()) return;
  view.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="固定資産税, Tokyo Gas, 上越市…" autofocus></div>
    <div id="list" class="empty">Search OCR text, titles and issuers. Japanese works.</div>`;
  const q = $("#q");
  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const v = q.value.trim();
      if (!v) { $("#list").className = "empty"; $("#list").textContent = "Search OCR text, titles and issuers."; return; }
      fillList("#list", `/api/search?q=${encodeURIComponent(v)}`, "No matches.");
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
    el.textContent = err.status === 503 ? "No database configured yet." : `Could not load: ${err.message}`;
  }
}

async function docView(id) {
  if (gate()) return;
  view.innerHTML = `<div class="empty">Loading…</div>`;
  let d;
  try { ({ document: d } = await api(`/api/documents/${id}`)); }
  catch (err) { view.innerHTML = `<div class="empty">${err.status === 404 ? "Not found." : esc(err.message)}</div>`; return; }

  const x = d.extracted_data || {};
  const fields = [
    ["Type", d.document_type], ["Issuer", d.issuer], ["Date", d.document_date],
    ["Amount", x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null],
    ["Due", x.due_date], ["Reference", x.reference_number],
    ["Categories", Array.isArray(x.categories) ? x.categories.join(", ") : null],
    ...Object.entries(x).filter(([k]) => !["amount", "currency", "due_date", "reference_number", "categories"].includes(k)).map(([k, v]) => [k, String(v)]),
    ["Status", d.status + (d.error ? ` — ${d.error}` : "")],
    ["Model", d.extraction_model], ["OCR", d.ocr_provider],
  ].filter(([, v]) => v != null && v !== "");

  const driveLink = d.drive_file_id ? `https://drive.google.com/file/d/${encodeURIComponent(d.drive_file_id)}/view` : null;

  view.innerHTML = `
    <div class="card">
      <h3>${esc(d.title)}</h3>
      <div class="meta">${esc(d.summary || "")}</div>
      ${actionLine(d)}
      <div class="keep" id="keep">${retentionLabel(d.retention)} <span class="meta">— ${esc(d.retention_reason || "")}</span></div>
      ${decideButtons(d.id)}
      ${driveLink ? `<div class="drive">📁 <a href="${driveLink}" target="_blank" rel="noopener">Open in Google Drive</a></div>`
                  : d.status === "failed" ? `<div class="notice">Not in Drive — re-scan to file it.</div>` : ""}
      <dl class="fields">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <details><summary class="meta">OCR text</summary><pre>${esc(d.ocr_text || "")}</pre></details>
      <div class="footer-actions">
        <a href="#/recent" class="meta">← Recent</a>
        <button class="small danger" id="del">Delete</button>
      </div>
    </div>`;
  wireDecide(view, d.id);
  $("#del").addEventListener("click", async () => {
    if (!confirm("Remove this document from the archive? The Drive file is moved to trash.")) return;
    try { await api(`/api/documents/${d.id}`, { method: "DELETE" }); location.hash = "#/recent"; }
    catch (err) { alert("Delete failed: " + err.message); }
  });
}

// ---------- cards ----------

const RETENTION = {
  digital_sufficient: "◎ Digital copy likely sufficient",
  keep_temporarily:   "◍ Keep temporarily",
  keep_original:      "◑ Keep original",
  unsure:             "⚠ Unsure — your call",
};
const retentionLabel = (r) => RETENTION[r] || esc(r || "");

function dueInfo(dateStr) {
  if (!dateStr) return { text: "", cls: "" };
  const days = Math.round((new Date(dateStr) - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return { text: `overdue by ${-days}d`, cls: "overdue" };
  if (days === 0) return { text: "due today", cls: "overdue" };
  if (days <= 7) return { text: `due in ${days}d`, cls: "warn" };
  return { text: `due ${dateStr}`, cls: "" };
}

function actionLine(d) {
  if (!d.action_required) return "";
  const due = dueInfo(d.action_date);
  return `<div class="action">⚠ ${esc(d.action_type || "action required")}${due.text ? " · " + due.text : ""}</div>`;
}

function listCard(d) {
  const a = document.createElement("a");
  a.className = "card"; a.href = `#/doc/${d.id}`;
  const due = d.action_required ? dueInfo(d.action_date) : null;
  const meta = [d.issuer, d.document_date].filter(Boolean).join(" · ");
  a.innerHTML = `
    <h3>${esc(d.title || "(untitled)")}</h3>
    <div class="row">
      <span class="meta">${esc(meta)}</span>
      ${due ? `<span class="pill ${due.cls}">${esc(d.action_type || "action")}${due.text ? " · " + due.text : ""}</span>` : ""}
      ${d.retention === "unsure" ? `<span class="pill warn">review</span>` : ""}
      ${d.status === "failed" ? `<span class="pill">not in Drive</span>` : ""}
    </div>`;
  return a;
}

function resultCard(data) {
  const x = data.extraction, el = document.createElement("div");
  el.className = "card";
  const money = x.amount != null ? `${x.currency || ""} ${Number(x.amount).toLocaleString()}` : null;
  let drive = "";
  if (data.filed) drive = `<div class="drive">📁 <a href="${esc(data.filed.link)}" target="_blank" rel="noopener">${esc(data.filed.path)}</a></div>`;
  else if (data.filing_error === "reconnect_google") drive = `<div class="notice">Google access has lapsed — <a href="/auth/login">sign in again</a>, then re-scan to file it.</div>`;
  else if (data.filing_error) drive = `<div class="notice">Indexed, but filing to Drive failed. Nothing is kept server-side, so re-scan to file it.</div>`;
  else if (!state.signedIn) drive = `<div class="meta">Not filed — sign in with Google to file scans to your Drive.</div>`;
  el.innerHTML = `
    <h3>${esc(x.title)}</h3>
    <div class="meta">${esc([x.issuer, x.document_date, money].filter(Boolean).join(" · "))}</div>
    <div class="meta">${esc(x.summary)}</div>
    ${actionLine(x)}
    <div class="keep" id="keep">${retentionLabel(x.retention)} <span class="meta">— ${esc(x.retention_reason)}</span></div>
    ${data.id ? decideButtons(data.id) : ""}
    ${drive}
    <details><summary class="meta">OCR (${data.ocr.pages} page${data.ocr.pages === 1 ? "" : "s"}, ${data.ocr.chars} chars)${data.id ? ` · <a href="#/doc/${data.id}">open</a>` : " · not indexed"}</summary><pre>${esc(data.ocr.text)}</pre></details>`;
  if (data.id) wireDecide(el, data.id);
  return el;
}

function decideButtons(id) {
  return `<div class="decide" data-id="${esc(id)}">
    <button data-r="digital_sufficient">Digital is enough</button>
    <button data-r="keep_temporarily">Keep for now</button>
    <button data-r="keep_original">Keep original</button>
  </div>`;
}

function wireDecide(root, id) {
  root.querySelectorAll(".decide button").forEach((b) => b.addEventListener("click", async () => {
    const retention = b.dataset.r;
    b.disabled = true;
    try {
      await api(`/api/documents/${id}/retention`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retention, reason: "Decided by user" }),
      });
      const keep = root.querySelector("#keep") || root.querySelector(".keep");
      if (keep) keep.textContent = RETENTION[retention];
      const box = root.querySelector(".decide"); if (box) box.remove();
    } catch (err) { b.disabled = false; alert("Could not save: " + err.message); }
  }));
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }

// ---------- boot ----------

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
(async () => { await whoami(); await route(); })();
