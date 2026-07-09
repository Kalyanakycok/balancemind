// Альтернативная реализация хранения данных BalanceMind поверх Postgres
// (Vercel Postgres / Neon / Supabase и т.п.), вместо Excel-файла в Vercel Blob.
//
// Экспортирует ТОЧНО ТЕ ЖЕ функции с теми же сигнатурами, что и ./store.js
// (loadWorkbook, saveWorkbook, getUsers/setUsers, ...), поэтому переход на
// Postgres — это замена одной строки require() в каждом api/*.js файле:
//   const { loadWorkbook, ... } = require('./_lib/store');
// на:
//   const { loadWorkbook, ... } = require('./_lib/store-postgres');
//
// Как включить:
//   1. Завести базу (Vercel Postgres или Neon — оба дают connection string).
//   2. Прописать переменную окружения POSTGRES_URL (или DATABASE_URL) в
//      настройках проекта на Vercel — Settings → Environment Variables.
//   3. Добавить в package.json зависимость "pg" (см. ниже — версия указана).
//   4. Поменять require в нужных api/*.js файлах на store-postgres.
//   5. Задеплоить — таблицы и сид-аккаунты создадутся сами при первом запросе.
//
// "wb" здесь — не файл Excel, а простой объект-снимок всех таблиц в памяти
// ({ users, appeals, forumPosts, forumComments }), который loadWorkbook()
// читает из Postgres, а saveWorkbook() целиком перезаписывает обратно —
// это осознанно повторяет модель "перечитать всё / переписать всё" из
// store.js (replaceSheet), чтобы код в api/*.js не пришлось переписывать.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

let pool = null;
function getPool() {
    if (!pool) {
        if (!connectionString) {
            throw new Error('Не задана переменная окружения POSTGRES_URL (или DATABASE_URL).');
        }
        pool = new Pool({
            connectionString,
            ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false }
        });
    }
    return pool;
}

let schemaEnsured = false;
async function ensureSchema() {
    if (schemaEnsured) return;
    const client = getPool();
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id       SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role     TEXT NOT NULL DEFAULT 'user',
            label    TEXT NOT NULL DEFAULT '',
            built_in BOOLEAN NOT NULL DEFAULT FALSE
        );
        CREATE TABLE IF NOT EXISTS appeals (
            id      TEXT PRIMARY KEY,
            "from"  TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            date    TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS forum_posts (
            id      TEXT PRIMARY KEY,
            author  TEXT NOT NULL,
            title   TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            date    TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS forum_comments (
            id      TEXT PRIMARY KEY,
            post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
            author  TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            date    TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_forum_comments_post_id ON forum_comments(post_id);

        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at  TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

        CREATE TABLE IF NOT EXISTS journal_entries (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            title       TEXT NOT NULL DEFAULT '',
            note        TEXT NOT NULL DEFAULT '',
            mood        TEXT NOT NULL DEFAULT '',
            liked       BOOLEAN NOT NULL DEFAULT FALSE,
            likes       INTEGER NOT NULL DEFAULT 0,
            date        TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_journal_entries_username ON journal_entries(username);

        CREATE TABLE IF NOT EXISTS checklist_items (
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            task        TEXT NOT NULL,
            checked     BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (username, task)
        );

        CREATE TABLE IF NOT EXISTS mood_logs (
            username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
            mood        TEXT NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS daily_plans (
            username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
            state       JSONB NOT NULL DEFAULT '{}',
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS test_results (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            test_id     TEXT NOT NULL DEFAULT 'stress',
            score       INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT '',
            date        TEXT NOT NULL DEFAULT '',
            timestamp   TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_test_results_username ON test_results(username, test_id);

        CREATE TABLE IF NOT EXISTS notif_read (
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            notif_id    TEXT NOT NULL,
            PRIMARY KEY (username, notif_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
            channel     TEXT NOT NULL DEFAULT 'admin',
            sender      TEXT NOT NULL DEFAULT 'user',
            author      TEXT NOT NULL DEFAULT '',
            text        TEXT NOT NULL DEFAULT '',
            date        TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(username, channel, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, created_at);

        CREATE TABLE IF NOT EXISTS password_recovery (
            username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
            word_hash   TEXT NOT NULL
        );
    `);
    schemaEnsured = true;
}

async function loadWorkbook() {
    const client = getPool();
    await ensureSchema();

    const [usersRes, appealsRes, postsRes, commentsRes] = await Promise.all([
        client.query('SELECT username, password, role, label, built_in AS "builtIn" FROM users ORDER BY id'),
        client.query('SELECT id, "from", subject, message, date FROM appeals ORDER BY date'),
        client.query('SELECT id, author, title, message, date FROM forum_posts ORDER BY date'),
        client.query('SELECT id, post_id AS "postId", author, message, date FROM forum_comments ORDER BY date')
    ]);

    let users = usersRes.rows;
    if (users.length === 0) {
        // Первый запуск на пустой базе — сид совпадает с исходным store.js.
        // ВНИМАНИЕ: это дефолтные пароли только для самого первого входа на
        // свежей базе. Этот файл открытый (публичный репозиторий) — сразу
        // после первого деплоя смените пароли admin/Potap через страницу
        // логина, иначе они будут известны любому, кто читает код.
        const seedPlain = [
            { username: 'admin', password: 'admin123', role: 'admin', label: 'Администратор', builtIn: true },
            { username: 'user', password: 'user123', role: 'user', label: 'Пользователь', builtIn: true },
            { username: 'Potap', password: 'admin123', role: 'admin', label: 'Главный администратор', builtIn: false }
        ];
        for (const u of seedPlain) {
            u.password = await hashPassword(u.password);
        }
        await persistUsers(seedPlain);
        users = seedPlain;
    }

    return {
        users,
        appeals: appealsRes.rows,
        forumPosts: postsRes.rows,
        forumComments: commentsRes.rows
    };
}

// ВАЖНО: раньше все четыре persist*-функции делали `DELETE FROM x` (весь
// стол целиком), затем заново вставляли все строки. Для forum_posts и
// особенно users это катастрофично: у users.username и forum_posts.id есть
// внешние ключи с ON DELETE CASCADE (sessions, journal_entries, test_results,
// forum_comments и т.д.) — удаление ВСЕХ строк users, пусть даже на мгновение
// перед повторной вставкой, каскадом стирало сессии/дневники/тесты/комментарии
// у ВСЕХ пользователей при любом сохранении хотя бы одного (логин, регистрация,
// смена роли, новый пост на форуме). Теперь — точечный UPSERT: удаляются
// только строки, которых больше нет в новом наборе, остальные обновляются
// на месте без потери id и без каскадного удаления связанных данных.
async function persistUsers(users) {
    const client = getPool();
    const usernames = users.map((u) => u.username);
    await client.query(
        usernames.length ? 'DELETE FROM users WHERE username <> ALL($1::text[])' : 'DELETE FROM users',
        usernames.length ? [usernames] : []
    );
    for (const u of users) {
        await client.query(
            `INSERT INTO users (username, password, role, label, built_in) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, label = EXCLUDED.label, built_in = EXCLUDED.built_in`,
            [u.username, u.password, u.role, u.label, !!u.builtIn]
        );
    }
}
async function persistAppeals(appeals) {
    const client = getPool();
    const ids = appeals.map((a) => String(a.id));
    await client.query(
        ids.length ? 'DELETE FROM appeals WHERE id <> ALL($1::text[])' : 'DELETE FROM appeals',
        ids.length ? [ids] : []
    );
    for (const a of appeals) {
        await client.query(
            `INSERT INTO appeals (id, "from", subject, message, date) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET "from" = EXCLUDED."from", subject = EXCLUDED.subject, message = EXCLUDED.message, date = EXCLUDED.date`,
            [a.id, a.from, a.subject || '', a.message || '', a.date || '']
        );
    }
}
async function persistForumPosts(posts) {
    const client = getPool();
    const ids = posts.map((p) => String(p.id));
    await client.query(
        ids.length ? 'DELETE FROM forum_posts WHERE id <> ALL($1::text[])' : 'DELETE FROM forum_posts',
        ids.length ? [ids] : []
    );
    for (const p of posts) {
        await client.query(
            `INSERT INTO forum_posts (id, author, title, message, date) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET author = EXCLUDED.author, title = EXCLUDED.title, message = EXCLUDED.message, date = EXCLUDED.date`,
            [p.id, p.author, p.title || '', p.message || '', p.date || '']
        );
    }
}
async function persistForumComments(comments) {
    const client = getPool();
    const ids = comments.map((c) => String(c.id));
    await client.query(
        ids.length ? 'DELETE FROM forum_comments WHERE id <> ALL($1::text[])' : 'DELETE FROM forum_comments',
        ids.length ? [ids] : []
    );
    for (const c of comments) {
        await client.query(
            `INSERT INTO forum_comments (id, post_id, author, message, date) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET post_id = EXCLUDED.post_id, author = EXCLUDED.author, message = EXCLUDED.message, date = EXCLUDED.date`,
            [c.id, c.postId, c.author, c.message || '', c.date || '']
        );
    }
}

// saveWorkbook перезаписывает все 4 таблицы снимком из wb — так же, как
// store.js целиком пересобирает лист Excel в replaceSheet().
async function saveWorkbook(wb) {
    await Promise.all([
        persistUsers(wb.users),
        persistAppeals(wb.appeals),
        persistForumPosts(wb.forumPosts),
        persistForumComments(wb.forumComments)
    ]);
}

function getUsers(wb) { return wb.users; }
function setUsers(wb, users) { wb.users = users; }
function getAppeals(wb) { return wb.appeals; }
function setAppeals(wb, appeals) { wb.appeals = appeals; }
function getForumPosts(wb) { return wb.forumPosts; }
function setForumPosts(wb, posts) { wb.forumPosts = posts; }
function getForumComments(wb) { return wb.forumComments; }
function setForumComments(wb, comments) { wb.forumComments = comments; }

function publicUser(u) {
    return { username: u.username, role: u.role, label: u.label, builtIn: !!u.builtIn };
}

// --- пароли: идентично store.js (bcrypt + обратная совместимость) ---
function isHashedPassword(pw) {
    return typeof pw === 'string' && /^\$2[aby]\$/.test(pw);
}
async function hashPassword(pw) {
    return bcrypt.hash(String(pw), 10);
}
async function verifyPassword(inputPassword, storedPassword) {
    if (isHashedPassword(storedPassword)) {
        return bcrypt.compare(String(inputPassword), storedPassword);
    }
    return String(inputPassword) === String(storedPassword);
}

// ---------- сессии (замена доверию клиентскому полю username) ----------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

async function createSession(username, role) {
    await ensureSchema();
    const client = getPool();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await client.query(
        'INSERT INTO sessions (token, username, role, expires_at) VALUES ($1,$2,$3,$4)',
        [token, username, role, expiresAt]
    );
    return token;
}

async function getSession(token) {
    if (!token) return null;
    await ensureSchema();
    const client = getPool();
    const res = await client.query(
        'SELECT username, role, expires_at AS "expiresAt" FROM sessions WHERE token = $1',
        [token]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
        await client.query('DELETE FROM sessions WHERE token = $1', [token]);
        return null;
    }
    return { username: row.username, role: row.role };
}

async function deleteSession(token) {
    if (!token) return;
    await ensureSchema();
    const client = getPool();
    await client.query('DELETE FROM sessions WHERE token = $1', [token]);
}

// ---------- личные данные (дневник, чек-лист, настроение, план дня,
// история тестов, прочитанные уведомления) — всегда по username из сессии ----------

async function getJournalEntries(username) {
    await ensureSchema();
    const res = await getPool().query(
        'SELECT id, title, note, mood, liked, likes, date FROM journal_entries WHERE username = $1 ORDER BY created_at',
        [username]
    );
    return res.rows;
}
async function saveJournalEntry(username, entry) {
    await ensureSchema();
    const id = String(entry.id || Date.now());
    await getPool().query(
        'INSERT INTO journal_entries (id, username, title, note, mood, date) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, username, entry.title || '', entry.note || '', entry.mood || '', entry.date || '']
    );
    return { id, title: entry.title || '', note: entry.note || '', mood: entry.mood || '', liked: false, likes: 0, date: entry.date || '' };
}
async function deleteJournalEntry(username, id) {
    await ensureSchema();
    await getPool().query('DELETE FROM journal_entries WHERE username = $1 AND id = $2', [username, String(id)]);
}
async function toggleJournalLike(username, id) {
    await ensureSchema();
    const client = getPool();
    const res = await client.query('SELECT liked, likes FROM journal_entries WHERE username = $1 AND id = $2', [username, String(id)]);
    const row = res.rows[0];
    if (!row) return null;
    const liked = !row.liked;
    const likes = Math.max(0, (row.likes || 0) + (liked ? 1 : -1));
    await client.query('UPDATE journal_entries SET liked = $1, likes = $2 WHERE username = $3 AND id = $4', [liked, likes, username, String(id)]);
    return { liked, likes };
}

async function getChecklist(username) {
    await ensureSchema();
    const res = await getPool().query('SELECT task, checked FROM checklist_items WHERE username = $1', [username]);
    return res.rows;
}
async function setChecklist(username, items) {
    await ensureSchema();
    const client = getPool();
    await client.query('DELETE FROM checklist_items WHERE username = $1', [username]);
    for (const item of items || []) {
        await client.query(
            'INSERT INTO checklist_items (username, task, checked) VALUES ($1,$2,$3)',
            [username, item.task, !!item.checked]
        );
    }
}

async function getMood(username) {
    await ensureSchema();
    const res = await getPool().query('SELECT mood FROM mood_logs WHERE username = $1', [username]);
    return res.rows[0] ? res.rows[0].mood : null;
}
async function setMood(username, mood) {
    await ensureSchema();
    await getPool().query(
        `INSERT INTO mood_logs (username, mood, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (username) DO UPDATE SET mood = EXCLUDED.mood, updated_at = now()`,
        [username, mood]
    );
}

async function getDailyPlan(username) {
    await ensureSchema();
    const res = await getPool().query('SELECT state FROM daily_plans WHERE username = $1', [username]);
    return res.rows[0] ? res.rows[0].state : {};
}
async function setDailyPlan(username, state) {
    await ensureSchema();
    await getPool().query(
        `INSERT INTO daily_plans (username, state, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (username) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [username, JSON.stringify(state || {})]
    );
}

async function getTestResults(username, testId = 'stress') {
    await ensureSchema();
    const res = await getPool().query(
        'SELECT id, score, status, date, timestamp FROM test_results WHERE username = $1 AND test_id = $2 ORDER BY created_at',
        [username, testId]
    );
    return res.rows;
}
async function saveTestResult(username, testId, score, status, date, timestamp) {
    await ensureSchema();
    const id = String(Date.now());
    await getPool().query(
        'INSERT INTO test_results (id, username, test_id, score, status, date, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, username, testId || 'stress', score, status || '', date || '', timestamp || '']
    );
    return { id, score, status: status || '', date: date || '', timestamp: timestamp || '' };
}

async function getNotifRead(username) {
    await ensureSchema();
    const res = await getPool().query('SELECT notif_id AS "notifId" FROM notif_read WHERE username = $1', [username]);
    return res.rows.map((r) => r.notifId);
}
async function setNotifRead(username, ids) {
    await ensureSchema();
    const client = getPool();
    await client.query('DELETE FROM notif_read WHERE username = $1', [username]);
    for (const id of ids || []) {
        await client.query('INSERT INTO notif_read (username, notif_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [username, String(id)]);
    }
}

// ---------- админ: обзор всех пользователей, сброс пароля, удаление ----------
// Всё это уже защищено на уровне api/admin.js проверкой requireAuth + role
// === 'admin' — сюда обращаются только после этой проверки.

async function adminGetUsersOverview() {
    await ensureSchema();
    const client = getPool();
    const users = (await client.query('SELECT username, role, label FROM users ORDER BY username')).rows;
    const overview = [];
    for (const u of users) {
        const [testsRes, journalCountRes, journalRecentRes] = await Promise.all([
            client.query(
                `SELECT DISTINCT ON (test_id) test_id, score, status, date FROM test_results
                 WHERE username = $1 ORDER BY test_id, created_at DESC`,
                [u.username]
            ),
            client.query('SELECT count(*) FROM journal_entries WHERE username = $1', [u.username]),
            client.query(
                'SELECT title, note, mood, date FROM journal_entries WHERE username = $1 ORDER BY created_at DESC LIMIT 3',
                [u.username]
            )
        ]);
        overview.push({
            username: u.username,
            role: u.role,
            label: u.label,
            latestTests: testsRes.rows,
            journalCount: Number(journalCountRes.rows[0].count),
            recentJournal: journalRecentRes.rows
        });
    }
    return overview;
}

async function adminSetPassword(username, hashedPassword) {
    await ensureSchema();
    const client = getPool();
    const res = await client.query('UPDATE users SET password = $1 WHERE username = $2', [hashedPassword, username]);
    await client.query('DELETE FROM sessions WHERE username = $1', [username]);
    return res.rowCount > 0;
}

async function adminDeleteUser(username) {
    await ensureSchema();
    const client = getPool();
    // ON DELETE CASCADE на внешних ключах чистит sessions/journal_entries/
    // checklist_items/mood_logs/daily_plans/test_results/notif_read/messages сам.
    const res = await client.query('DELETE FROM users WHERE username = $1', [username]);
    return res.rowCount > 0;
}

// ---------- переписка с персоналом (администратор / психолог) ----------

async function getThreadMessages(username, channel) {
    await ensureSchema();
    const res = await getPool().query(
        'SELECT id, username, channel, sender, author, text, date FROM messages WHERE username = $1 AND channel = $2 ORDER BY created_at',
        [username, channel]
    );
    return res.rows;
}
async function addMessage(username, channel, sender, author, text, date) {
    await ensureSchema();
    const id = String(Date.now()) + Math.floor(Math.random() * 1000);
    await getPool().query(
        'INSERT INTO messages (id, username, channel, sender, author, text, date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, username, channel, sender, author || '', text || '', date || '']
    );
    return { id, username, channel, sender, author: author || '', text: text || '', date: date || '' };
}
// Список тредов для персонала: по одному на пользователя, писавшего в канал,
// с последним сообщением и числом непрочитанных (от пользователя без ответа).
async function getStaffThreads(channel) {
    await ensureSchema();
    const res = await getPool().query(
        `SELECT m.username,
                (SELECT text FROM messages WHERE username = m.username AND channel = m.channel ORDER BY created_at DESC LIMIT 1) AS "lastText",
                (SELECT date FROM messages WHERE username = m.username AND channel = m.channel ORDER BY created_at DESC LIMIT 1) AS "lastDate",
                (SELECT sender FROM messages WHERE username = m.username AND channel = m.channel ORDER BY created_at DESC LIMIT 1) AS "lastSender",
                count(*) AS "total"
         FROM messages m
         WHERE m.channel = $1
         GROUP BY m.username, m.channel
         ORDER BY max(m.created_at) DESC`,
        [channel]
    );
    return res.rows.map((r) => ({ username: r.username, lastText: r.lastText, lastDate: r.lastDate, lastSender: r.lastSender, total: Number(r.total) }));
}

// ---------- контрольное слово для восстановления пароля ----------

async function setRecoveryWord(username, wordHash) {
    await ensureSchema();
    await getPool().query(
        `INSERT INTO password_recovery (username, word_hash) VALUES ($1,$2)
         ON CONFLICT (username) DO UPDATE SET word_hash = EXCLUDED.word_hash`,
        [username, wordHash]
    );
}
async function getRecoveryWordHash(username) {
    await ensureSchema();
    const res = await getPool().query('SELECT word_hash AS "wordHash" FROM password_recovery WHERE username = $1', [username]);
    return res.rows[0] ? res.rows[0].wordHash : null;
}

module.exports = {
    loadWorkbook, saveWorkbook,
    getUsers, setUsers,
    getAppeals, setAppeals,
    getForumPosts, setForumPosts,
    getForumComments, setForumComments,
    publicUser,
    isHashedPassword, hashPassword, verifyPassword,
    createSession, getSession, deleteSession,
    getJournalEntries, saveJournalEntry, deleteJournalEntry, toggleJournalLike,
    getChecklist, setChecklist,
    getMood, setMood,
    getDailyPlan, setDailyPlan,
    getTestResults, saveTestResult,
    getNotifRead, setNotifRead,
    adminGetUsersOverview, adminSetPassword, adminDeleteUser,
    getThreadMessages, addMessage, getStaffThreads,
    setRecoveryWord, getRecoveryWordHash
};
