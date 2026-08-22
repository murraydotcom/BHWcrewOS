/* BHW Capture MVP service worker.
   Intentionally does not intercept network requests or cache CrewOS pages. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
