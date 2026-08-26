const CACHE = "amt-price-list-shell-v3";
const BASE = "/amt_price_list";
const DEVELOPMENT_HOST = ["localhost", "127.0.0.1", "[::1]"].includes(
  self.location.hostname,
);
self.addEventListener("install", () => {
  if (DEVELOPMENT_HOST) self.skipWaiting();
});
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          BASE + "/",
          BASE + "/logo.svg",
          BASE + "/manifest.webmanifest",
          BASE + "/icon-192.png",
        ]),
      ),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("amt-price-list-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  if (DEVELOPMENT_HOST) return;
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE + "/") ||
    url.pathname.startsWith(BASE + "/api/") ||
    url.search
  )
    return;
  if (req.mode === "navigate")
    event.respondWith(fetch(req).catch(() => caches.match(BASE + "/")));
  else if (
    url.pathname.startsWith(BASE + "/_next/static/") ||
    [
      "/logo.svg",
      "/icon-192.png",
      "/icon-512.png",
      "/icon-maskable.png",
    ].map((path) => BASE + path).includes(url.pathname)
  )
    event.respondWith(
      caches.open(CACHE).then(
        async (cache) =>
          (await cache.match(req)) ||
          fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }),
      ),
    );
});
