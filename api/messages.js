// Переписка пользователя с персоналом (администратор / психолог).
// В отличие от ИИ-ассистента (api/assistant-chat.js) это живой двусторонний
// диалог с человеком: пользователь пишет, персонал отвечает, история хранится.
//
// Каналы: 'admin' (администраторы) и 'psychologist' (психологи).
//   - канал 'admin' обслуживают пользователи с role === 'admin'
//   - канал 'psychologist' обслуживают role === 'psychologist' И role === 'admin'
//     (админ видит оба канала как главный).
//
// Действия (?action=):
//   GET  ?action=thread&channel=...      — своя переписка (любой залогиненный)
//   POST ?action=send&channel=...        — отправить сообщение персоналу
//   GET  ?action=inbox&channel=...       — список тредов канала (только персонал)
//   GET  ?action=thread&channel=...&user=X — прочитать чужой тред (только персонал)
//   POST ?action=reply&channel=...       — ответить пользователю (только персонал)

const { getThreadMessages, addMessage, getStaffThreads, publicUser } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

const CHANNELS = ['admin', 'psychologist'];

function canServe(role, channel) {
    if (role === 'admin') return true;                 // админ видит оба канала
    if (role === 'psychologist' && channel === 'psychologist') return true;
    return false;
}

function nowStr() {
    return new Date().toLocaleString('ru-RU');
}

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    const q = req.query || {};
    const action = q.action || '';
    const channel = CHANNELS.includes(q.channel) ? q.channel : 'admin';

    // ---- пользователь читает свою переписку с каналом ----
    if (action === 'thread' && req.method === 'GET' && !q.user) {
        res.status(200).json(await getThreadMessages(session.username, channel));
        return;
    }

    // ---- пользователь пишет в канал ----
    if (action === 'send' && req.method === 'POST') {
        const { text } = req.body || {};
        if (!text || !String(text).trim()) {
            res.status(400).json({ error: 'Сообщение не может быть пустым' });
            return;
        }
        const msg = await addMessage(session.username, channel, 'user', session.username, String(text).slice(0, 4000), nowStr());
        res.status(200).json(msg);
        return;
    }

    // ---- дальше только для персонала соответствующего канала ----
    if (!canServe(session.role, channel)) {
        res.status(403).json({ error: 'Недостаточно прав для этого канала' });
        return;
    }

    // ---- персонал: список тредов канала ----
    if (action === 'inbox' && req.method === 'GET') {
        res.status(200).json(await getStaffThreads(channel));
        return;
    }

    // ---- персонал: прочитать конкретный тред пользователя ----
    if (action === 'thread' && req.method === 'GET' && q.user) {
        res.status(200).json(await getThreadMessages(q.user, channel));
        return;
    }

    // ---- персонал: ответить пользователю ----
    if (action === 'reply' && req.method === 'POST') {
        const { user, text } = req.body || {};
        if (!user || !text || !String(text).trim()) {
            res.status(400).json({ error: 'user и text обязательны' });
            return;
        }
        // Имя, под которым пользователь увидит ответ: подпись роли.
        const staffLabel = session.role === 'psychologist' ? 'Психолог' : 'Администратор';
        const msg = await addMessage(user, channel, 'staff', staffLabel, String(text).slice(0, 4000), nowStr());
        res.status(200).json(msg);
        return;
    }

    res.status(400).json({ error: 'Неизвестное действие' });
};
