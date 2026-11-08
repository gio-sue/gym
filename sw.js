/* Service worker di Gym: tiene una copia dei file dell'app sul telefono,
 * così l'app si apre anche senza rete. I dati NON passano di qui (stanno in IndexedDB).
 * Quando si pubblica una nuova versione, aumentare il numero in VERSIONE. */
const VERSIONE = 'gym-v3';
const FILE = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(nomi => Promise.all(nomi.filter(n => n !== VERSIONE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Solo i file dell'app (GET dello stesso sito). Le chiamate al ponte vanno dritte in rete.
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Subito la copia salvata (l'app si apre all'istante anche con rete debole);
  // intanto si scarica la versione nuova, che si vedrà alla prossima apertura.
  const dallaRete = fetch(req).then(risposta => {
    if (risposta.ok) { const copia = risposta.clone(); caches.open(VERSIONE).then(c => c.put(req, copia)); }
    return risposta;
  });
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(salvata => {
      if (salvata) { dallaRete.catch(() => {}); return salvata; }
      return dallaRete.catch(() => caches.match('index.html'));
    })
  );
});
