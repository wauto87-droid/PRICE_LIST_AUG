const CACHE = "amt-shell-v2";
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
          "/",
          "/logo.svg",
          "/manifest.webmanifest",
          "/icon-192.png",
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
            .filter((k) => k.startsWith("amt-shell-") && k !== CACHE)
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
    url.pathname.startsWith("/api/") ||
    url.search
  )
    return;
  if (req.mode === "navigate")
    event.respondWith(fetch(req).catch(() => caches.match("/")));
  else if (
    url.pathname.startsWith("/_next/static/") ||
    [
      "/logo.svg",
      "/icon-192.png",
      "/icon-512.png",
      "/icon-maskable.png",
    ].includes(url.pathname)
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
