self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const payload = event.data;
  if (payload && payload.type === 'SHOW_OS_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(payload.title, payload.options || {})
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(data.url || '/');
      }
    })
  );
});
