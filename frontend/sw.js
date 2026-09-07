const CACHE_NAME = 'ups-staff-mobile-v1';
const ASSETS = [
    './mobile.html',
    './mobile.js',
    './img/ups-logo.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only cache GET requests and ignore chrome-extension / API requests
    if (event.request.method !== 'GET' || event.request.url.includes('/rest/v1/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).then(fetchRes => {
                return caches.open(CACHE_NAME).then(cache => {
                    if (event.request.url.startsWith('http')) {
                        cache.put(event.request, fetchRes.clone());
                    }
                    return fetchRes;
                });
            });
        })
    );
});

self.addEventListener('push', (event) => {
    let data = { title: 'Notification', body: 'New update.' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }
    
    // Default options (GENERAL)
    let options = {
        body: data.body,
        icon: './img/ups-logo.svg',
        badge: './img/ups-logo.svg',
        data: data,
        silent: true,
        tag: 'general'
    };

    // Evaluate Priority Based on Event Type
    const criticalEvents = ['payment_submitted', 'support_ticket_created'];
    const importantEvents = ['address_completed'];

    if (criticalEvents.includes(data.event_type)) {
        // CRITICAL Priority
        options.silent = false;
        options.requireInteraction = true;
        options.vibrate = [300, 100, 300, 100, 300]; // SOS/Urgent Pattern
        options.tag = 'critical-' + (data.related_id || Date.now());
        options.renotify = true;
    } else if (importantEvents.includes(data.event_type)) {
        // IMPORTANT Priority
        options.silent = false;
        options.requireInteraction = false;
        options.vibrate = [200, 100, 200];
        options.tag = 'important-' + (data.related_id || Date.now());
    }

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetData = event.notification.data || {};
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('/mobile.html') && 'focus' in client) {
                    client.postMessage({ type: 'PUSH_ROUTE', data: targetData });
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                const url = new URL('./mobile.html', self.location.origin);
                if (targetData.event_type) {
                    url.searchParams.append('action', targetData.event_type);
                    url.searchParams.append('id', targetData.related_id || '');
                    if (targetData.notification_id) {
                        url.searchParams.append('nid', targetData.notification_id);
                    }
                }
                return clients.openWindow(url.href);
            }
        })
    );
});
