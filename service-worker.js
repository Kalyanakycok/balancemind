// BalanceMind — простой service worker для офлайн-доступа к основным страницам.
// Дневник, история и результаты тестов хранятся в localStorage браузера,
// поэтому доступны офлайн сами по себе — этот файл кеширует только статические
// страницы/иконки, чтобы сайт вообще открывался без сети.

const CACHE_NAME = 'balancemind-cache-v2';
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/advice.html',
    '/articles.html',
    '/practices.html',
    '/selfanalysis.html',
    '/community.html',
    '/about.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // API-запросы никогда не кешируем — данные форума/обращений должны быть свежими.
    if (url.pathname.startsWith('/api/')) return;
    // Внешние CDN-скрипты, шрифты и виджеты VK пропускаем как есть.
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                    }
                    return response;
                })
       