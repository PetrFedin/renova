self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open('renova-v1').then(c => c.addAll(['/']))); });
self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
