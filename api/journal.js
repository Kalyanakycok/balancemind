const { getJournalEntries, saveJournalEntry, deleteJournalEntry, toggleJournalLike } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    if (req.method === 'GET') {
        res.status(200).json(await getJournalEntries(session.username));
        return;
    }
    if (req.method === 'POST') {
        const { title, note, mood, date } = req.body || {};
        if (!title || !note) {
            res.status(400).json({ error: 'Заголовок и заметка обязательны' });
            return;
        }
        const entry = await saveJournalEntry(session.username, { title, note, mood, date });
        res.status(200).json(entry);
        return;
    }
    if (req.method === 'PATCH') {
        const { id } = req.body || {};
        if (!id) {
            res.status(400).json({ error: 'id обязателен' });
            return;
        }
        const result = await toggleJournalLike(session.username, id);
        if (!result) {
            res.status(404).json({ error: 'Запись не найдена' });
            return;
        }
        res.status(200).json(result);
        return;
    }
    if (req.method === 'DELETE') {
        const id = (req.query && req.query.id) || (new URL(req.url, 'http://x').searchParams.get('id'));
        if (!id) {
            res.status(400).json({ error: 'id обязателен' });
            return;
        }
        await deleteJournalEntry(session.username, id);
        res.status(200).json({ ok: true });
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
