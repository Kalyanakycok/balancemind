// Объединённый эндпоинт: mood / daily-plan / notif-read — раньше были тремя
// отдельными serverless-функциями; объединены под ?type=, чтобы уложиться
// в лимит функций на бесплатном тарифе Vercel.
const { getMood, setMood, getDailyPlan, setDailyPlan, getNotifRead, setNotifRead } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    const type = (req.query && req.query.type) || '';

    if (type === 'mood') {
        if (req.method === 'GET') { res.status(200).json({ mood: await getMood(session.username) }); return; }
        if (req.method === 'PUT') {
            const { mood } = req.body || {};
            if (!mood) { res.status(400).json({ error: 'mood обязателен' }); return; }
            await setMood(session.username, mood);
            res.status(200).json({ ok: true });
            return;
        }
    }

    if (type === 'daily-plan') {
        if (req.method === 'GET') { res.status(200).json(await getDailyPlan(session.username)); return; }
        if (req.method === 'PUT') {
            const { state } = req.body || {};
            await setDailyPlan(session.username, state && typeof state === 'object' ? state : {});
            res.status(200).json({ ok: true });
            return;
        }
    }

    if (type === 'notif-read') {
        if (req.method === 'GET') { res.status(200).json(await getNotifRead(session.username)); return; }
        if (req.method === 'PUT') {
            const { ids } = req.body || {};
            await setNotifRead(session.username, Array.isArray(ids) ? ids : []);
            res.status(200).json({ ok: true });
            return;
        }
    }

    res.status(400).json({ error: 'Неизвестный тип или метод' });
};
