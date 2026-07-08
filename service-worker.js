// BalanceMind — простой service worker для офлайн-доступа к основным страницам.
// Личные данные (дневник, история теста, чек-лист и т.д.) теперь хранятся на
// сервере через /api/* (Postgres), поэтому недоступны офлайн — этот файл
// кеширует только статические страницы/ассеты/иконки, чтобы сайт открывался
// без сети хотя бы для чтения.

const CACHE_NAME = 'balancemind-cache-v3';
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
    '/assets/site.css',
    '/assets/site.js',
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
       