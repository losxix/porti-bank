/* PORTI BANK — guarda o app no celular para abrir mesmo sem internet.
   Os dados da partida (Supabase) nunca passam por aqui. */
const CACHE = "porti-bank-v62";
const SHELL = [
  "./", "index.html", "app.js", "cards-art.js", "config.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png", "banco-comeu.webp", "logo.webp", "porti-status.css", "status-ferias.svg", "status-preso.svg",
  "vendor/supabase.js",
  "vendor/qrcode.js",
  "vendor/jsqr.js"
];

self.addEventListener("install", e => {
  // One file failing (a slow CDN, for example) must not stop the rest from being saved.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const font = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === "cdn.jsdelivr.net";
  if (!same && !font) return;                                      // Supabase etc.: straight to the network
  if (same && /\/(rest|realtime|auth)\/v1\//.test(url.pathname)) return;

  // Show the saved copy right away and refresh it in the background.
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
                (req.mode === "navigate" ? await cache.match("index.html") || await cache.match("./") : null);
    const fresh = fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    return res || new Response("Sem internet", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
