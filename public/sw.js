/* App-shell cache only. API, auth and MCP always go to the network. */
const VERSION = "pa-shell-v4";
const SHELL = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.webmanifest",
               "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/vendor/qrcode.mjs"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (/^\/(api|auth|mcp|health)(\/|$)/.test(url.pathname)) return; // never cached

  // Network first so deploys land immediately; cache is the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))),
  );
});
