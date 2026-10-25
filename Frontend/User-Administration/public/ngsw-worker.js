/*
 * A one-time kill switch for an old Angular service worker.
 *
 * This app has no service worker of its own. If an earlier user-admin build ever installed
 * Angular's ngsw-worker.js, that registration can keep serving its own cached index and hide
 * every later release. Replacing that script with this one makes the browser's next update check
 * unregister it, delete its ngsw caches (the memo app's Workbox cache is not touched), and reload
 * the open pages so they come from the network.
 *
 * If the app ever adopts a real service worker, delete this file first.
 */
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const names = await caches.keys();
      await Promise.all(
        names.filter(name => name.startsWith('ngsw:')).map(name => caches.delete(name))
      );
      const clients = await self.clients.matchAll({type: 'window'});
      await Promise.allSettled(clients.map(client => client.navigate(client.url)));
    })()
  );
});
