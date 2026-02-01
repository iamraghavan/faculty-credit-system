self.addEventListener('push', function (event) {
    console.log('[Service Worker] Push Received.');
    console.log(`[Service Worker] Push had this data: "${event.data.text()}"`);

    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'Default Title', body: event.data.text() };
    }

    const title = data.title || 'Notification';
    const options = {
        body: data.body || 'No body content.',
        icon: data.icon || 'https://via.placeholder.com/128',
        badge: 'https://via.placeholder.com/64',
        data: { url: data.url || '/' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
    console.log('[Service Worker] Notification click Received.');

    event.notification.close();

    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
