// 서비스 워커 - 오프라인 캐싱
const CACHE = "mindmap-v1";
const ASSETS = ["/", "/static/style.css", "/static/mindmap.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener("fetch", e => {
  // API 요청은 네트워크 우선
  if (e.request.url.includes("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // 정적 파일은 캐시 우선
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
