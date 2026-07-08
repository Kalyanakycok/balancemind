const { getNotifRead, setNotifRead } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    if (req.method === 'GET') {
        res.status(200).json(await getNotifRead(session.username));
        return;
    }
    if (req.method === 'PUT') {
        const { ids } = req.body || {};
        await setNotifRead(session.username, Array.isArray(ids) ? ids : []);
        res.status(200).json({ ok: true });
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
