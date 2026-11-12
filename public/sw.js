const CACHE = 'tepic-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tepic-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Do not cache authenticated navigation or order data. Offline is an explicit fallback.
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin && ['/icon-192.png', '/offline.html'].includes(new URL(event.request.url).pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const offline = await caches.match('/offline.html');
    // A host may normalize .html URLs with a redirect. Return a fresh response.
    return offline ? new Response(await offline.text(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error();
  }));
});
