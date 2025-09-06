const CACHE = "handitalk-v4";  // -> bump to v5

const PRECACHE = [
  "/",
  "/libs/tflite/tf-tflite.min.js",
  "/models/handitalk_landmarks.tflite",
  "/models/class_names_landmarks.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const heavy = url.pathname.startsWith("/models/") || url.pathname.startsWith("/libs/");
  if (heavy) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        c.put(e.request, res.clone());
        return res;
      })
    );
  } else if (url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    e.respondWith(
      fetch(e.request).then((res) => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
