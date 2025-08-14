self.addEventListener('install', e=>{
  e.waitUntil(caches.open('drphone-v1').then(c=>c.addAll(['/','/assets/css/style.css','/assets/js/app.js'])));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
});