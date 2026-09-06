/**
 * AnonVote service worker — AppShell + runtime caching
 *
 * Strategy:
 *   - AppShell (HTML shell + critical assets): cache-first, served on install
 *   - JS/CSS/images: stale-while-revalidate so updates ship on next visit
 *   - /api/*: network-first, no caching (votes must reach the server)
 *   - offline fallback: serve the cached index.html for navigate requests
 */

const CACHE_VERSION = "anonvote-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = ["/", "/index.html"];

// ── Install: pre-cache AppShell ───────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: evict stale caches ─────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: routing logic ──────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls — votes and tokens must always reach the server
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: serve AppShell from cache, fallback to network
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .match("/index.html")
        .then((cached) => cached ?? fetch(request))
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images): stale-while-revalidate
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image"
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        });
        return cached ?? networkFetch;
      }),
    );
  }
});
