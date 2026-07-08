/* ===================================================================
   BalanceMind — общий клиентский модуль.
   Подключается на всех страницах (<script src="/assets/site.js" defer>)
   вместо дублирования одной и той же логики в каждом HTML-файле.
   =================================================================== */
(function () {
    'use strict';

    const AUTH_KEY = 'balance_auth';
    const THEME_KEY = 'balance_theme';

    // Единый набор эмодзи настроения — используется везде (главная, тест,
    // дневник), чтобы сохранённое значение всегда подсвечивалось как выбранное
    // независимо от того, на какой странице его сохранили.
    const MOOD_OPTIONS = [
        { mood: '😀', label: 'Отлично' },
        { mood: '🙂', label: 'Хорошо' },
        { mood: '😐', label: 'Нормально' },
        { mood: '😔', label: 'Тяжело' },
        { mood: '😣', label: 'Очень тяжело' },
        { mood: '😴', label: 'Вымотан(а)' }
    ];

    // ---------------------------------------------------------------
    // Escape — защита от XSS при вставке пользовательского текста в innerHTML
    // ---------------------------------------------------------------
    const Escape = {
        html(str) {
            return String(str ?? '').replace(/[&<>"']/g, (c) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }
    };

    // ---------------------------------------------------------------
    // Toast — короткие всплывающие уведомления вместо alert()
    // ---------------------------------------------------------------
    const Toast = {
        _stack() {
            let el = document.getElementById('bm-toast-stack');
            if (!el) {
                el = document.createElement('div');
                el.id = 'bm-toast-stack';
                document.body.appendChild(el);
            }
            return el;
        },
        show(message, type = 'info') {
            const stack = this._stack();
            const item = document.createElement('div');
            item.className = `bm-toast${type === 'error' ? ' error' : ''}`;
            item.textContent = message;
            stack.appendChild(item);
            setTimeout(() => item.remove(), 3800);
        }
    };

    // ---------------------------------------------------------------
    // Auth — состояние входа, токен сессии, обёртка над fetch
    // ---------------------------------------------------------------
    const Auth = {
        getState() {
            try {
                return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
            } catch {
                return null;
            }
        },
        setState(account) {
            localStorage.setItem(AUTH_KEY, JSON.stringify(account));
            document.dispatchEvent(new CustomEvent('bm:auth-changed', { detail: account }));
        },
        clear() {
            localStorage.removeItem(AUTH_KEY);
            document.dispatchEvent(new CustomEvent('bm:auth-changed', { detail: null }));
        },
        isLoggedIn() {
            const s = this.getState();
            return !!(s && s.token);
        },
        // Обёртка над fetch, сама добавляет Authorization: Bearer <token>,
        // если пользователь залогинен — так все обращения к личным данным
        // и модерации идут от реальной серверной сессии, а не от того,
        // что клиент сам про себя заявил.
        async authFetch(url, opts = {}) {
            const state = this.getState();
            const headers = Object.assign({}, opts.headers || {});
            if (state && state.token) headers['Authorization'] = `Bearer ${state.token}`;
            return fetch(url, Object.assign({}, opts, { headers }));
        },
        async login(username, password) {
            const res = await fetch('/api/auth?action=login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Неверный логин или пароль.');
            this.setState(data);
            return data;
        },
        async register(username, password, role = 'user') {
            const res = await fetch('/api/auth?action=register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось зарегистрироваться.');
            this.setState(data);
            return data;
        },
        async logout() {
            const state = this.getState();
            if (state && state.token) {
                try {
                    await fetch('/api/auth?action=logout', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } });
                } catch { /* сеть недоступна — всё равно чистим локально */ }
            }
            this.clear();
        }
    };

    // ---------------------------------------------------------------
    // PersonalData — дневник/чек-лист/настроение/план дня/история теста/
    // прочитанные уведомления. Если пользователь залогинен — данные идут
    // на сервер (Postgres, привязаны к username из сессии). Если гость —
    // складываются в localStorage под ОТДЕЛЬНЫМ namespaced-ключом, чтобы
    // не путаться с данными какого-либо аккаунта на этом же браузере.
    // ---------------------------------------------------------------
    function guestKey(name) { return `balance_guest_${name}`; }
    function readGuest(name, fallback) {
        try { return JSON.parse(localStorage.getItem(guestKey(name)) || JSON.stringify(fallback)); }
        catch { return fallback; }
    }
    function writeGuest(name, value) {
        localStorage.setItem(guestKey(name), JSON.stringify(value));
    }

    const PersonalData = {
        async getJournal() {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/journal');
                return res.ok ? res.json() : [];
            }
            return readGuest('journal', []);
        },
        async saveJournalEntry(entry) {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/journal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry)
                });
                return res.json();
            }
            const entries = readGuest('journal', []);
            const row = Object.assign({ id: Date.now(), liked: false, likes: 0 }, entry);
            entries.push(row);
            writeGuest('journal', entries);
            return row;
        },
        async deleteJournalEntry(id) {
            if (Auth.isLoggedIn()) {
                await Auth.authFetch(`/api/journal?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
                return;
            }
            writeGuest('journal', readGuest('journal', []).filter((e) => String(e.id) !== String(id)));
        },
        async toggleJournalLike(id) {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/journal', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                return res.ok ? res.json() : null;
            }
            const entries = readGuest('journal', []);
            const entry = entries.find((e) => String(e.id) === String(id));
            if (!entry) return null;
            entry.liked = !entry.liked;
            entry.likes = Math.max(0, (entry.likes || 0) + (entry.liked ? 1 : -1));
            writeGuest('journal', entries);
            return { liked: entry.liked, likes: entry.likes };
        },

        async getChecklist() {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/checklist');
                return res.ok ? res.json() : [];
            }
            return readGuest('checklist', []);
        },
        async setChecklist(items) {
            if (Auth.isLoggedIn()) {
                await Auth.authFetch('/api/checklist', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items })
                });
                return;
            }
            writeGuest('checklist', items);
        },

        async getMood() {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/profile?type=mood');
                return res.ok ? (await res.json()).mood : null;
            }
            return readGuest('mood', null);
        },
        async setMood(mood) {
            if (Auth.isLoggedIn()) {
                await Auth.authFetch('/api/profile?type=mood', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mood })
                });
                return;
            }
            writeGuest('mood', mood);
        },

        async getDailyPlan() {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/profile?type=daily-plan');
                return res.ok ? res.json() : {};
            }
            return readGuest('daily_plan', {});
        },
        async setDailyPlan(state) {
            if (Auth.isLoggedIn()) {
                await Auth.authFetch('/api/profile?type=daily-plan', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state })
                });
                return;
            }
            writeGuest('daily_plan', state);
        },

        async getTestResults(testId = 'stress') {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch(`/api/test-results?testId=${encodeURIComponent(testId)}`);
                return res.ok ? res.json() : [];
            }
            return readGuest(`test_results_${testId}`, []);
        },
        async saveTestResult(testId, score, status, date, timestamp) {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch(`/api/test-results?testId=${encodeURIComponent(testId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score, status, date, timestamp })
                });
                return res.json();
            }
            const results = readGuest(`test_results_${testId}`, []);
            const row = { id: Date.now(), score, status, date, timestamp };
            results.push(row);
            writeGuest(`test_results_${testId}`, results);
            return row;
        },

        async getNotifRead() {
            if (Auth.isLoggedIn()) {
                const res = await Auth.authFetch('/api/profile?type=notif-read');
                return res.ok ? res.json() : [];
            }
            return readGuest('notif_read', []);
        },
        async setNotifRead(ids) {
            if (Auth.isLoggedIn()) {
                await Auth.authFetch('/api/profile?type=notif-read', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                return;
            }
            writeGuest('notif_read', ids);
        }
    };

    // ---------------------------------------------------------------
    // Forum — форум сообщества (сервер сам подставляет автора из сессии,
    // если пользователь залогинен; удаление постов/комментариев теперь
    // требует роль admin на сервере, а не просто скрыто в UI).
    // ---------------------------------------------------------------
    const Forum = {
        async getPosts() {
            const res = await fetch('/api/forum-posts');
            if (!res.ok) throw new Error('Не удалось получить темы форума.');
            return res.json();
        },
        async createPost(title, message) {
            const state = Auth.getState();
            const res = await Auth.authFetch('/api/forum-posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, message, author: state ? state.username : 'Гость' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось создать тему.');
            return data;
        },
        async getComments() {
            const res = await fetch('/api/forum-comments');
            if (!res.ok) throw new Error('Не удалось получить комментарии.');
            return res.json();
        },
        async createComment(postId, message) {
            const state = Auth.getState();
            const res = await Auth.authFetch('/api/forum-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId, message, author: state ? state.username : 'Гость' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Не удалось отправить комментарий.');
            return data;
        },
        async deletePost(id) {
            const res = await Auth.authFetch(`/api/forum-posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).error || 'Не удалось скрыть тему.');
            return res.json();
        },
        async deleteComment(id) {
            const res = await Auth.authFetch(`/api/forum-comments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).error || 'Не удалось скрыть комментарий.');
            return res.json();
        },
        isAdmin() {
            const s = Auth.getState();
            return !!(s && s.role === 'admin');
        }
    };

    // ---------------------------------------------------------------
    // Theme — переключатель тёмная/светлая (глобальная UI-настройка,
    // осознанно НЕ персональные данные — не связана с аккаунтом).
    // ---------------------------------------------------------------
    const Theme = {
        get() { return localStorage.getItem(THEME_KEY) || 'dark'; },
        set(theme) {
            localStorage.setItem(THEME_KEY, theme);
            document.documentElement.setAttribute('data-theme', theme);
            const icon = document.getElementById('theme-toggle-icon');
            const label = document.getElementById('theme-toggle-label');
            if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
            if (label) label.textContent = theme === 'dark' ? 'Тёмная' : 'Светлая';
        },
        toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
        init() { this.set(this.get()); }
    };

    // ---------------------------------------------------------------
    // Notifications — персональные напоминания на основе реальных данных
    // пользователя (когда был последний тест, есть ли записи в дневнике,
    // отмечен ли план на сегодня). Прочитанные — хранятся через
    // PersonalData.getNotifRead()/setNotifRead(), как и раньше.
    // ---------------------------------------------------------------
    const Notifications = {
        async generate() {
            if (!Auth.isLoggedIn()) {
                return [{ id: 'guest', text: 'Войдите в аккаунт, чтобы получать персональные напоминания.', href: null }];
            }
            const notifs = [];
            const [testResults, journal, plan] = await Promise.all([
                PersonalData.getTestResults('stress'),
                PersonalData.getJournal(),
                PersonalData.getDailyPlan()
            ]);

            if (!testResults.length) {
                notifs.push({ id: 'test-none', text: 'Вы ещё не проходили тест на стресс — самое время начать.', href: '/selfanalysis.html' });
            } else {
                const last = testResults[testResults.length - 1];
                const lastTime = Date.parse(last.timestamp || '') || 0;
                const daysSince = lastTime ? Math.floor((Date.now() - lastTime) / 86400000) : 0;
                if (daysSince >= 7) {
                    notifs.push({ id: `test-stale-${Math.floor(daysSince / 7)}`, text: `Прошло ${daysSince} дн. с последнего теста на стресс — стоит пройти снова.`, href: '/selfanalysis.html' });
                }
            }

            if (!journal.length) {
                notifs.push({ id: 'journal-none', text: 'Дневник пока пуст — первая запись помогает заметить закономерности.', href: '/selfanalysis.html' });
            }

            const planDoneToday = Object.values(plan || {}).some(Boolean);
            if (!planDoneToday) {
                notifs.push({ id: 'plan-today', text: 'План на сегодня ещё не отмечен — загляните в «Практики».', href: '/practices.html' });
            }

            if (!notifs.length) {
                notifs.push({ id: 'all-good', text: 'Вы молодец — на сегодня всё отмечено. Загляните позже.', href: null });
            }
            return notifs;
        },
        async render() {
            const list = document.getElementById('bm-notif-dropdown');
            const badge = document.getElementById('bm-notif-badge');
            if (!list || !badge) return;
            const notifs = await this.generate();
            const readIds = Auth.isLoggedIn() ? await PersonalData.getNotifRead() : [];
            list.innerHTML = '';
            notifs.forEach((n) => {
                const unread = !readIds.includes(n.id);
                const item = document.createElement(n.href ? 'a' : 'div');
                if (n.href) item.href = n.href;
                item.className = 'bm-dropdown-item' + (unread ? ' unread' : '');
                item.textContent = n.text;
                list.appendChild(item);
            });
            const unreadCount = notifs.filter((n) => !readIds.includes(n.id)).length;
            if (unreadCount > 0) {
                badge.style.display = 'flex';
                badge.textContent = String(unreadCount);
            } else {
                badge.style.display = 'none';
            }
            this._lastIds = notifs.map((n) => n.id);
        },
        async markAllRead() {
            if (!Auth.isLoggedIn() || !this._lastIds) return;
            await PersonalData.setNotifRead(this._lastIds);
            this.render();
        }
    };

    // ---------------------------------------------------------------
    // Header — общий хедер/nav/меню входа, монтируется в <div id="site-header">
    // ---------------------------------------------------------------
    const NAV_ITEMS = [
        { href: '/index.html', label: 'Главная' },
        { href: '/selfanalysis.html', label: 'Тесты' },
        { href: '/practices.html', label: 'Практики' },
        { href: '/articles.html', label: 'Статьи' },
        { href: '/community.html', label: 'Сообщество' },
        { href: '/advice.html', label: 'Советы' },
        { href: '/about.html', label: 'О проекте' }
    ];

    const Header = {
        mount() {
            const root = document.getElementById('site-header');
            if (!root) return;
            const path = location.pathname.split('/').pop() || 'index.html';
            const navHtml = NAV_ITEMS.map((item) => {
                const active = item.href.endsWith(path) ? ' active' : '';
                return `<li><a href="${item.href}" class="${active.trim()}">${item.label}</a></li>`;
            }).join('');

            root.innerHTML = `
                <div class="bm-header">
                    <div class="bm-header-inner">
                        <a href="/index.html" class="bm-logo"><span class="bm-logo-mark">🌙</span> BalanceMind</a>
                        <button class="bm-burger" id="bm-burger" type="button" aria-label="Меню" aria-expanded="false" aria-controls="bm-nav-links">☰</button>
                        <ul class="bm-nav-links" id="bm-nav-links">${navHtml}</ul>
                        <div class="bm-header-actions">
                            <div style="position:relative;">
                                <button class="bm-icon-btn" id="bm-notif-btn" type="button" aria-label="Уведомления">
                                    🔔<span class="bm-notif-badge" id="bm-notif-badge" style="display:none;">0</span>
                                </button>
                                <div class="bm-dropdown glass-card" id="bm-notif-dropdown"></div>
                            </div>
                            <button class="bm-icon-btn" id="bm-theme-toggle" type="button" aria-label="Переключить тему">
                                <span id="theme-toggle-icon">🌙</span>
                            </button>
                            <div id="bm-auth-slot"></div>
                        </div>
                    </div>
                </div>`;

            const burger = document.getElementById('bm-burger');
            const navLinks = document.getElementById('bm-nav-links');
            burger.addEventListener('click', () => {
                const open = navLinks.classList.toggle('mobile-open');
                burger.setAttribute('aria-expanded', String(open));
            });
            document.addEventListener('click', (e) => {
                if (navLinks.classList.contains('mobile-open') && !navLinks.contains(e.target) && e.target !== burger) {
                    navLinks.classList.remove('mobile-open');
                    burger.setAttribute('aria-expanded', 'false');
                }
            });
            document.getElementById('bm-theme-toggle').addEventListener('click', () => Theme.toggle());
            document.getElementById('bm-notif-btn').addEventListener('click', () => {
                const dd = document.getElementById('bm-notif-dropdown');
                dd.classList.toggle('open');
                if (dd.classList.contains('open')) {
                    setTimeout(() => Notifications.markAllRead(), 1500);
                }
            });
            document.addEventListener('click', (e) => {
                const dd = document.getElementById('bm-notif-dropdown');
                if (dd && !dd.contains(e.target) && e.target.id !== 'bm-notif-btn') dd.classList.remove('open');
            });

            this.renderAuthSlot();
            Notifications.render();
            document.addEventListener('bm:auth-changed', () => { this.renderAuthSlot(); Notifications.render(); });
        },

        renderAuthSlot() {
            const slot = document.getElementById('bm-auth-slot');
            if (!slot) return;
            const state = Auth.getState();
            if (state && state.token) {
                const initial = Escape.html((state.label || state.username || '?').trim().charAt(0).toUpperCase());
                slot.innerHTML = `
                    <div class="bm-auth-pill">
                        <span class="avatar">${initial}</span>
                        <span>${Escape.html(state.username)}</span>
                        <button class="btn-ghost" id="bm-logout-btn" type="button" style="padding:4px 8px;border-radius:999px;">Выйти</button>
                    </div>`;
                document.getElementById('bm-logout-btn').addEventListener('click', async () => {
                    await Auth.logout();
                    Toast.show('Вы вышли из аккаунта');
                });
            } else {
                slot.innerHTML = `<button class="btn btn-primary" id="bm-login-open" type="button" style="padding:9px 18px;">Войти</button>`;
                document.getElementById('bm-login-open').addEventListener('click', () => AuthModal.open());
            }
        }
    };

    // ---------------------------------------------------------------
    // AuthModal — единое модальное окно входа/регистрации (раньше формы
    // логина были продублированы внутри разметки каждой страницы).
    // ---------------------------------------------------------------
    const AuthModal = {
        _ensure() {
            if (document.getElementById('bm-auth-modal')) return;
            const wrap = document.createElement('div');
            wrap.id = 'bm-auth-modal';
            wrap.style.cssText = 'position:fixed;inset:0;z-index:400;display:none;align-items:center;justify-content:center;background:rgba(5,6,14,0.6);backdrop-filter:blur(4px);';
            wrap.innerHTML = `
                <div class="glass-card" style="width:min(360px,90vw);padding:28px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <strong style="font-family:var(--font-display);">Вход в BalanceMind</strong>
                        <button class="btn-ghost" id="bm-auth-close" type="button" style="padding:4px 8px;">✕</button>
                    </div>
                    <div style="display:flex;gap:6px;margin-bottom:16px;">
                        <button class="btn btn-secondary" id="bm-tab-login" type="button" style="flex:1;padding:8px;">Войти</button>
                        <button class="btn-ghost" id="bm-tab-register" type="button" style="flex:1;padding:8px;">Регистрация</button>
                    </div>
                    <form id="bm-auth-form" style="display:flex;flex-direction:column;gap:10px;">
                        <input class="bm-input" id="bm-auth-username" placeholder="Логин" autocomplete="username" required>
                        <input class="bm-input" id="bm-auth-password" type="password" placeholder="Пароль" autocomplete="current-password" required>
                        <div id="bm-auth-error" style="color:#ff8fb8;font-size:0.82rem;min-height:1em;"></div>
                        <button class="btn btn-primary" type="submit">Войти</button>
                    </form>
                </div>`;
            document.body.appendChild(wrap);

            let mode = 'login';
            const setMode = (m) => {
                mode = m;
                document.getElementById('bm-tab-login').className = m === 'login' ? 'btn btn-secondary' : 'btn-ghost';
                document.getElementById('bm-tab-register').className = m === 'register' ? 'btn btn-secondary' : 'btn-ghost';
                document.querySelector('#bm-auth-form button[type="submit"]').textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
                document.getElementById('bm-auth-error').textContent = '';
            };
            document.getElementById('bm-tab-login').addEventListener('click', () => setMode('login'));
            document.getElementById('bm-tab-register').addEventListener('click', () => setMode('register'));
            document.getElementById('bm-auth-close').addEventListener('click', () => this.close());
            wrap.addEventListener('click', (e) => { if (e.target === wrap) this.close(); });

            document.getElementById('bm-auth-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.target.querySelector('button[type="submit"]');
                if (submitBtn.disabled) return;
                const username = document.getElementById('bm-auth-username').value.trim();
                const password = document.getElementById('bm-auth-password').value;
                const errorEl = document.getElementById('bm-auth-error');
                errorEl.textContent = '';
                submitBtn.disabled = true;
                try {
                    if (mode === 'login') await Auth.login(username, password);
                    else await Auth.register(username, password, 'user');
                    Toast.show(mode === 'login' ? 'Добро пожаловать!' : 'Аккаунт создан!');
                    this.close();
                } catch (err) {
                    errorEl.textContent = err.message || 'Что-то пошло не так.';
                } finally {
                    submitBtn.disabled = false;
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && wrap.style.display === 'flex') this.close();
            });
        },
        open() { this._ensure(); document.getElementById('bm-auth-modal').style.display = 'flex'; },
        close() { const m = document.getElementById('bm-auth-modal'); if (m) m.style.display = 'none'; }
    };

    // ---------------------------------------------------------------
    // ChatWidget — плавающий ИИ-ассистент на Claude API
    // ---------------------------------------------------------------
    const ChatWidget = {
        _history: [],
        mount() {
            const launcher = document.createElement('button');
            launcher.id = 'bm-chat-launcher';
            launcher.type = 'button';
            launcher.setAttribute('aria-label', 'Открыть ИИ-ассистента');
            launcher.textContent = '💬';
            document.body.appendChild(launcher);

            const panel = document.createElement('div');
            panel.id = 'bm-chat-panel';
            panel.className = 'glass-card';
            panel.innerHTML = `
                <div class="bm-chat-head">
                    <div><strong>Ассистент BalanceMind</strong><br><span>на связи по вопросам стресса</span></div>
                    <button class="btn-ghost" id="bm-chat-close" type="button" style="padding:4px 8px;">✕</button>
                </div>
                <div class="bm-chat-body" id="bm-chat-body">
                    <div class="bm-chat-msg system-note">Я не заменяю специалиста. При тревожных или кризисных состояниях — раздел «Советы → Обращение к специалисту».</div>
                </div>
                <div class="bm-chat-input-row">
                    <textarea id="bm-chat-input" rows="1" placeholder="Спросите про стресс, тревогу, практики…"></textarea>
                    <button class="bm-chat-send" id="bm-chat-send" type="button" aria-label="Отправить">➤</button>
                </div>`;
            document.body.appendChild(panel);

            const toggle = () => panel.classList.toggle('open');
            launcher.addEventListener('click', toggle);
            document.getElementById('bm-chat-close').addEventListener('click', toggle);

            const send = () => this.send();
            document.getElementById('bm-chat-send').addEventListener('click', send);
            document.getElementById('bm-chat-input').addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            });

            try {
                this._history = JSON.parse(sessionStorage.getItem('bm_chat_history') || '[]');
                this._history.forEach((m) => this._renderMessage(m.role, m.content));
            } catch { this._history = []; }
        },
        _renderMessage(role, content) {
            const body = document.getElementById('bm-chat-body');
            const div = document.createElement('div');
            div.className = `bm-chat-msg ${role}`;
            div.textContent = content;
            body.appendChild(div);
            body.scrollTop = body.scrollHeight;
        },
        async send() {
            if (this._sending) return;
            const input = document.getElementById('bm-chat-input');
            const text = input.value.trim();
            if (!text) return;
            this._sending = true;
            input.value = '';
            this._history.push({ role: 'user', content: text });
            this._renderMessage('user', text);
            sessionStorage.setItem('bm_chat_history', JSON.stringify(this._history));

            const body = document.getElementById('bm-chat-body');
            const typing = document.createElement('div');
            typing.className = 'bm-chat-msg assistant';
            typing.innerHTML = '<span class="bm-chat-typing"><span></span><span></span><span></span></span>';
            body.appendChild(typing);
            body.scrollTop = body.scrollHeight;

            try {
                const res = await fetch('/api/assistant-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: this._history.slice(-10) })
                });
                const data = await res.json();
                typing.remove();
                if (!res.ok) throw new Error(data.error || 'Ассистент временно недоступен.');
                this._history.push({ role: 'assistant', content: data.reply });
                sessionStorage.setItem('bm_chat_history', JSON.stringify(this._history));
                this._renderMessage('assistant', data.reply);
            } catch (err) {
                typing.remove();
                this._renderMessage('assistant', err.message || 'Не удалось получить ответ. Попробуйте ещё раз чуть позже.');
            } finally {
                this._sending = false;
            }
        }
    };

    // ---------------------------------------------------------------
    // Инициализация
    // ---------------------------------------------------------------
    Theme.init();
    document.addEventListener('DOMContentLoaded', () => {
        Header.mount();
        ChatWidget.mount();
    });

    window.BM = { Escape, Toast, Auth, PersonalData, Forum, Theme, Header, AuthModal, ChatWidget, Notifications, MOOD_OPTIONS };
})();
