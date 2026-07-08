const { getMood, setMood } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    if (req.method === 'GET') {
        res.status(200).json({ mood: await getMood(session.username) });
        return;
    }
    if (req.method === 'PUT') {
        const { mood } = req.body || {};
        if (!mood) {
            res.status(400).json({ error: 'mood обязателен' });
            return;
        }
        await setMood(session.username, mood);
        res.status(200).json({ ok: true });
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
