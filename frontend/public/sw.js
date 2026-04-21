self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Alert';
  const isP1 = title.includes('P1');

  const options = {
    body: data.body || '',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: data.data?.alertId || 'alert',
    requireInteraction: isP1,
    vibrate: isP1 ? [400, 100, 400, 100, 400] : [200, 100, 200],
    silent: true, // suppress OS default sound — we play our own
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // wake all open tabs so they play custom sound
      self.clients.matchAll({ type: 'window' }).then(clientList => {
        clientList.forEach(client => {
          client.postMessage({ type: 'PLAY_ALERT', severity: isP1 ? 'P1' : 'P2' });
        });
      })
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
