self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Alert';
  const options = {
    body: data.body || '',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: data.data?.alertId || 'alert',
    requireInteraction: title.includes('P1'),
    vibrate: title.includes('P1') ? [300, 100, 300, 100, 300] : [200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
