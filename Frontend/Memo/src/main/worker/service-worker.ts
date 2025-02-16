/**
 * @prettier
 *
 * Service worker
 * https://developers.google.com/web/updates/2019/09/fresher-sw
 */

const staticCacheName = "site-static-v{AUTOINCREMENT_CACHE_VERSION}";
const assets = [
  "/memo/",
  "{ALL_SOURCES}",
  "/worker/app.js",
  "/org-manifest.json",
  "/favicon.ico",
];

// install event
self.addEventListener("install", (evt: ExtendableEvent) => {
  //console.log('service worker installed');
  evt.waitUntil(
    caches.open(staticCacheName).then((cache) => {
      console.log("caching shell assets");
      cache
        .addAll(assets)
        .catch((reason) => console.log("Failed to fetch", reason));
    })
  );
  ((self as unknown) as ServiceWorkerGlobalScope).skipWaiting();
});

// activate event
self.addEventListener("activate", (evt: ExtendableEvent) => {
  //console.log('service worker activated');
  evt.waitUntil(
    caches.keys().then((keys) => {
      //console.log(keys);
      return Promise.all(
        keys
          .filter((key) => key !== staticCacheName)
          .map((key) => caches.delete(key))
      );
    })
  );
});

// fetch event
self.addEventListener("fetch", (evt: FetchEvent) => {
  //console.log('fetch event', evt);
  evt.respondWith(
    caches.match(evt.request).then((cacheRes) => {
      return cacheRes || fetch(evt.request);
    })
  );
});
