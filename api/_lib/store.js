// Общая логика хранения данных BalanceMind в Vercel Blob (Excel-файл data.xlsx).
// В отличие от локального сервера (server/server.js), тут файл лежит не на диске,
// а в облачном Blob-хранилище Vercel — это нужно, потому что serverless-функции
// не сохраняют файлы на диске между запросами.

const { put, list } = require('@vercel/blob');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DATA_PATHNAME = 'data.xlsx';
const USERS_SHEET = 'Users';
const APPEALS_SHEET = 'Appeals';
const FORUM_POSTS_SHEET = 'ForumPosts';
const FORUM_COMMENTS_SHEET = 'ForumComments';
const SESSIONS_SHEET = 'Sessions';
const JOURNAL_SHEET = 'JournalEntries';
const CHECKLIST_SHEET = 'ChecklistItems';
const MOOD_SHEET = 'MoodLogs';
const PLAN_SHEET = 'DailyPlans';
const TEST_RESULTS_SHEET = 'TestResults';
const NOTIF_READ_SHEET = 'NotifRead';
const MESSAGES_SHEET = 'Messages';
const USER_COLUMNS = ['username', 'password', 'role', 'label', 'builtIn'];
const APPEAL_COLUMNS = ['id', 'from', 'subject', 'message', 'date'];
const FORUM_POST_COLUMNS = ['id', 'author', 'title', 'message', 'date'];
const FORUM_COMMENT_COLUMNS = ['id', 'postId', 'author', 'message', 'date'];
const SESSION_COLUMNS = ['token', 'username', 'role', 'expiresAt'];
const JOURNAL_COLUMNS = ['id', 'username', 'title', 'note', 'mood', 'liked', 'likes', 'date'];
const CHECKLIST_COLUMNS = ['username', 'task', 'checked'];
const MOOD_COLUMNS = ['username', 'mood'];
const PLAN_COLUMNS = ['username', 'state'];
const TEST_RESULTS_COLUMNS = ['id', 'username', 'testId', 'score', 'status', 'date', 'timestamp'];
const NOTIF_READ_COLUMNS = ['username', 'notifId'];
const MESSAGE_COLUMNS = ['id', 'username', 'channel', 'sender', 'author', 'text', 'date'];

function ensureSheet(wb, name, columns) {
    let ws = wb.getWorksheet(name);
    if (!ws) {
        ws = wb.addWorksheet(name);
        ws.addRow(columns);
    }
    return ws;
}

function readRows(ws, columns) {
    const rows = [];
    ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row.getCell(i + 1).value;
        });
        rows.push(obj);
    });
    return rows;
}

// Важно: пересоздаём лист целиком (а не spliceRows) — spliceRows на листах,
// загруженных из буфера, ненадёжно чистит старые строки и дублирует данные
// при повторной перезаписи одного и того же листа.
function replaceSheet(wb, name, columns, rows) {
    const existing = wb.getWorksheet(name);
    if (existing) wb.removeWorksheet(existing.id);
    const ws = wb.addWorksheet(name);
    ws.addRow(columns);
    rows.forEach((r) => ws.addRow(columns.map((c) => (r[c] === undefined ? '' : r[c]))));
    return ws;
}

async function findExistingBlobUrl() {
    const { blobs } = await list({ prefix: DATA_PATHNAME });
    const match = blobs.find((b) => b.pathname === DATA_PATHNAME);
    return match ? match.url : null;
}

async function loadWorkbook() {
    const wb = new ExcelJS.Workbook();
    const existingUrl = await findExistingBlobUrl();
    if (existingUrl) {
        const response = await fetch(existingUrl);
        const buf = Buffer.from(await response.arrayBuffer());
        await wb.xlsx.load(buf);
    }
    ensureSheet(wb, USERS_SHEET, USER_COLUMNS);
    ensureSheet(wb, APPEALS_SHEET, APPEAL_COLUMNS);
    ensureSheet(wb, FORUM_POSTS_SHEET, FORUM_POST_COLUMNS);
    ensureSheet(wb, FORUM_COMMENTS_SHEET, FORUM_COMMENT_COLUMNS);
    ensureSheet(wb, SESSIONS_SHEET, SESSION_COLUMNS);
    ensureSheet(wb, JOURNAL_SHEET, JOURNAL_COLUMNS);
    ensureSheet(wb, CHECKLIST_SHEET, CHECKLIST_COLUMNS);
    ensureSheet(wb, MOOD_SHEET, MOOD_COLUMNS);
    ensureSheet(wb, PLAN_SHEET, PLAN_COLUMNS);
    ensureSheet(wb, TEST_RESULTS_SHEET, TEST_RESULTS_COLUMNS);
    ensureSheet(wb, NOTIF_READ_SHEET, NOTIF_READ_COLUMNS);
    ensureSheet(wb, MESSAGES_SHEET, MESSAGE_COLUMNS);

    if (!existingUrl) {
        // ВНИМАНИЕ: дефолтные пароли только для первого входа на свежей базе.
        // Файл публичный — смените пароли admin/Potap сразу после деплоя.
        const seedUsersPlain = [
            { username: 'admin', password: 'admin123', role: 'admin', label: 'Администратор', builtIn: true },
            { username: 'user', password: 'user123', role: 'user', label: 'Пользователь', builtIn: true },
            { username: 'Potap', password: 'admin123', role: 'admin', label: 'Главный администратор', builtIn: false }
        ];
        const seedUsers = [];
        for (const u of seedUsersPlain) {
            seedUsers.push({ ...u, password: await hashPassword(u.password) });
        }
        replaceSheet(wb, USERS_SHEET, USER_COLUMNS, seedUsers);
        await saveWorkbook(wb);
    }
    return wb;
}

async function saveWorkbook(wb) {
    const buf = await wb.xlsx.writeBuffer();
    await put(DATA_PATHNAME, buf, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
}

function getUsers(wb) {
    return readRows(wb.getWorksheet(USERS_SHEET), USER_COLUMNS).map((u) => ({ ...u, builtIn: u.builtIn === true || u.builtIn === 'true' }));
}
function setUsers(wb, users) {
    replaceSheet(wb, USERS_SHEET, USER_COLUMNS, users);
}
function getAppeals(wb) {
    return readRows(wb.getWorksheet(APPEALS_SHEET), APPEAL_COLUMNS);
}
function setAppeals(wb, appeals) {
    replaceSheet(wb, APPEALS_SHEET, APPEAL_COLUMNS, appeals);
}
function getForumPosts(wb) {
    return readRows(wb.getWorksheet(FORUM_POSTS_SHEET), FORUM_POST_COLUMNS);
}
function setForumPosts(wb, posts) {
    replaceSheet(wb, FORUM_POSTS_SHEET, FORUM_POST_COLUMNS, posts);
}
function getForumComments(wb) {
    return readRows(wb.getWorksheet(FORUM_COMMENTS_SHEET), FORUM_COMMENT_COLUMNS);
}
function setForumComments(wb, comments) {
    replaceSheet(wb, FORUM_COMMENTS_SHEET, FORUM_COMMENT_COLUMNS, comments);
}
function publicUser(u) {
    return { username: u.username, role: u.role, label: u.label, builtIn: !!u.builtIn };
}

// --- пароли: bcrypt-хеши, с обратной совместимостью со старыми
// открытыми паролями (созданными до внедрения хеширования). ---
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
    // Легаси-запись (старый открытый пароль) — сравниваем как строки.
    return String(inputPassword) === String(storedPassword);
}

// ---------- сессии и личные данные (username-scoped, каждая функция сама
// грузит/сохраняет data.xlsx — как и остальные функции в этом файле) ----------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function createSession(username, role) {
    const wb = await loadWorkbook();
    const sessions = readRows(wb.getWorksheet(SESSIONS_SHEET), SESSION_COLUMNS);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.push({ token, username, role, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
    replaceSheet(wb, SESSIONS_SHEET, SESSION_COLUMNS, sessions);
    await saveWorkbook(wb);
    return token;
}
async function getSession(token) {
    if (!token) return null;
    const wb = await loadWorkbook();
    const sessions = readRows(wb.getWorksheet(SESSIONS_SHEET), SESSION_COLUMNS);
    const row = sessions.find((s) => s.token === token);
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    return { username: row.username, role: row.role };
}
async function deleteSession(token) {
    const wb = await loadWorkbook();
    const sessions = readRows(wb.getWorksheet(SESSIONS_SHEET), SESSION_COLUMNS).filter((s) => s.token !== token);
    replaceSheet(wb, SESSIONS_SHEET, SESSION_COLUMNS, sessions);
    await saveWorkbook(wb);
}

async function getJournalEntries(username) {
    const wb = await loadWorkbook();
    return readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS).filter((e) => e.username === username);
}
async function saveJournalEntry(username, entry) {
    const wb = await loadWorkbook();
    const entries = readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS);
    const id = String(entry.id || Date.now());
    const row = { id, username, title: entry.title || '', note: entry.note || '', mood: entry.mood || '', liked: false, likes: 0, date: entry.date || '' };
    entries.push(row);
    replaceSheet(wb, JOURNAL_SHEET, JOURNAL_COLUMNS, entries);
    await saveWorkbook(wb);
    return row;
}
async function deleteJournalEntry(username, id) {
    const wb = await loadWorkbook();
    const entries = readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS).filter((e) => !(e.username === username && String(e.id) === String(id)));
    replaceSheet(wb, JOURNAL_SHEET, JOURNAL_COLUMNS, entries);
    await saveWorkbook(wb);
}
async function toggleJournalLike(username, id) {
    const wb = await loadWorkbook();
    const entries = readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS);
    const entry = entries.find((e) => e.username === username && String(e.id) === String(id));
    if (!entry) return null;
    const liked = !entry.liked;
    const likes = Math.max(0, (Number(entry.likes) || 0) + (liked ? 1 : -1));
    entry.liked = liked;
    entry.likes = likes;
    replaceSheet(wb, JOURNAL_SHEET, JOURNAL_COLUMNS, entries);
    await saveWorkbook(wb);
    return { liked, likes };
}

async function getChecklist(username) {
    const wb = await loadWorkbook();
    return readRows(wb.getWorksheet(CHECKLIST_SHEET), CHECKLIST_COLUMNS).filter((i) => i.username === username);
}
async function setChecklist(username, items) {
    const wb = await loadWorkbook();
    const others = readRows(wb.getWorksheet(CHECKLIST_SHEET), CHECKLIST_COLUMNS).filter((i) => i.username !== username);
    const mine = (items || []).map((item) => ({ username, task: item.task, checked: !!item.checked }));
    replaceSheet(wb, CHECKLIST_SHEET, CHECKLIST_COLUMNS, [...others, ...mine]);
    await saveWorkbook(wb);
}

async function getMood(username) {
    const wb = await loadWorkbook();
    const row = readRows(wb.getWorksheet(MOOD_SHEET), MOOD_COLUMNS).find((m) => m.username === username);
    return row ? row.mood : null;
}
async function setMood(username, mood) {
    const wb = await loadWorkbook();
    const others = readRows(wb.getWorksheet(MOOD_SHEET), MOOD_COLUMNS).filter((m) => m.username !== username);
    replaceSheet(wb, MOOD_SHEET, MOOD_COLUMNS, [...others, { username, mood }]);
    await saveWorkbook(wb);
}

async function getDailyPlan(username) {
    const wb = await loadWorkbook();
    const row = readRows(wb.getWorksheet(PLAN_SHEET), PLAN_COLUMNS).find((p) => p.username === username);
    return row ? JSON.parse(row.state || '{}') : {};
}
async function setDailyPlan(username, state) {
    const wb = await loadWorkbook();
    const others = readRows(wb.getWorksheet(PLAN_SHEET), PLAN_COLUMNS).filter((p) => p.username !== username);
    replaceSheet(wb, PLAN_SHEET, PLAN_COLUMNS, [...others, { username, state: JSON.stringify(state || {}) }]);
    await saveWorkbook(wb);
}

async function getTestResults(username, testId = 'stress') {
    const wb = await loadWorkbook();
    return readRows(wb.getWorksheet(TEST_RESULTS_SHEET), TEST_RESULTS_COLUMNS)
        .filter((r) => r.username === username && r.testId === testId);
}
async function saveTestResult(username, testId, score, status, date, timestamp) {
    const wb = await loadWorkbook();
    const results = readRows(wb.getWorksheet(TEST_RESULTS_SHEET), TEST_RESULTS_COLUMNS);
    const id = String(Date.now());
    const row = { id, username, testId: testId || 'stress', score, status: status || '', date: date || '', timestamp: timestamp || '' };
    results.push(row);
    replaceSheet(wb, TEST_RESULTS_SHEET, TEST_RESULTS_COLUMNS, results);
    await saveWorkbook(wb);
    return row;
}

async function getNotifRead(username) {
    const wb = await loadWorkbook();
    return readRows(wb.getWorksheet(NOTIF_READ_SHEET), NOTIF_READ_COLUMNS).filter((n) => n.username === username).map((n) => n.notifId);
}
async function setNotifRead(username, ids) {
    const wb = await loadWorkbook();
    const others = readRows(wb.getWorksheet(NOTIF_READ_SHEET), NOTIF_READ_COLUMNS).filter((n) => n.username !== username);
    const mine = (ids || []).map((notifId) => ({ username, notifId: String(notifId) }));
    replaceSheet(wb, NOTIF_READ_SHEET, NOTIF_READ_COLUMNS, [...others, ...mine]);
    await saveWorkbook(wb);
}

// ---------- админ: обзор всех пользователей, сброс пароля, удаление ----------

async function adminGetUsersOverview() {
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    const allJournal = readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS);
    const allTests = readRows(wb.getWorksheet(TEST_RESULTS_SHEET), TEST_RESULTS_COLUMNS);
    return users.map((u) => {
        const myJournal = allJournal.filter((e) => e.username === u.username);
        const myTests = allTests.filter((r) => r.username === u.username);
        const latestByTest = {};
        myTests.forEach((r) => { latestByTest[r.testId] = r; });
        return {
            username: u.username,
            role: u.role,
            label: u.label,
            latestTests: Object.values(latestByTest).map((r) => ({ test_id: r.testId, score: r.score, status: r.status, date: r.date })),
            journalCount: myJournal.length,
            recentJournal: myJournal.slice(-3).reverse().map((e) => ({ title: e.title, note: e.note, mood: e.mood, date: e.date }))
        };
    });
}

async function adminSetPassword(username, hashedPassword) {
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    const target = users.find((u) => u.username === username);
    if (!target) return false;
    target.password = hashedPassword;
    setUsers(wb, users);
    const sessions = readRows(wb.getWorksheet(SESSIONS_SHEET), SESSION_COLUMNS).filter((s) => s.username !== username);
    replaceSheet(wb, SESSIONS_SHEET, SESSION_COLUMNS, sessions);
    await saveWorkbook(wb);
    return true;
}

async function adminDeleteUser(username) {
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    if (!users.some((u) => u.username === username)) return false;
    setUsers(wb, users.filter((u) => u.username !== username));
    replaceSheet(wb, SESSIONS_SHEET, SESSION_COLUMNS, readRows(wb.getWorksheet(SESSIONS_SHEET), SESSION_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, JOURNAL_SHEET, JOURNAL_COLUMNS, readRows(wb.getWorksheet(JOURNAL_SHEET), JOURNAL_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, CHECKLIST_SHEET, CHECKLIST_COLUMNS, readRows(wb.getWorksheet(CHECKLIST_SHEET), CHECKLIST_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, MOOD_SHEET, MOOD_COLUMNS, readRows(wb.getWorksheet(MOOD_SHEET), MOOD_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, PLAN_SHEET, PLAN_COLUMNS, readRows(wb.getWorksheet(PLAN_SHEET), PLAN_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, TEST_RESULTS_SHEET, TEST_RESULTS_COLUMNS, readRows(wb.getWorksheet(TEST_RESULTS_SHEET), TEST_RESULTS_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, NOTIF_READ_SHEET, NOTIF_READ_COLUMNS, readRows(wb.getWorksheet(NOTIF_READ_SHEET), NOTIF_READ_COLUMNS).filter((r) => r.username !== username));
    replaceSheet(wb, MESSAGES_SHEET, MESSAGE_COLUMNS, readRows(wb.getWorksheet(MESSAGES_SHEET), MESSAGE_COLUMNS).filter((r) => r.username !== username));
    await saveWorkbook(wb);
    return true;
}

// ---------- переписка с персоналом (администратор / психолог) ----------

async function getThreadMessages(username, channel) {
    const wb = await loadWorkbook();
    return readRows(wb.getWorksheet(MESSAGES_SHEET), MESSAGE_COLUMNS).filter((m) => m.username === username && m.channel === channel);
}
async function addMessage(username, channel, sender, author, text, date) {
    const wb = await loadWorkbook();
    const rows = readRows(wb.getWorksheet(MESSAGES_SHEET), MESSAGE_COLUMNS);
    const id = String(Date.now()) + Math.floor(Math.random() * 1000);
    const row = { id, username, channel, sender, author: author || '', text: text || '', date: date || '' };
    rows.push(row);
    replaceSheet(wb, MESSAGES_SHEET, MESSAGE_COLUMNS, rows);
    await saveWorkbook(wb);
    return row;
}
async function getStaffThreads(channel) {
    const wb = await loadWorkbook();
    const rows = readRows(wb.getWorksheet(MESSAGES_SHEET), MESSAGE_COLUMNS).filter((m) => m.channel === channel);
    const byUser = {};
    rows.forEach((m) => {
        if (!byUser[m.username]) byUser[m.username] = [];
        byUser[m.username].push(m);
    });
    return Object.keys(byUser).map((username) => {
        const list = byUser[username];
        const last = list[list.length - 1];
        return { username, lastText: last.text, lastDate: last.date, lastSender: last.sender, total: list.length };
    });
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
    getThreadMessages, addMessage, getStaffThreads
};
