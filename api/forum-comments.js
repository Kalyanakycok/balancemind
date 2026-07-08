const { loadWorkbook, saveWorkbook, getForumComments, setForumComments } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const wb = await loadWorkbook();
        res.status(200).json(getForumComments(wb));
        return;
    }
    if (req.method === 'POST') {
        const { postId, author, message } = req.body || {};
        if (!postId || !message) {
            res.status(400).json({ error: 'Комментарий не может быть пустым' });
            return;
        }
        const session = await requireAuth(req);
        const wb = await loadWorkbook();
        const comments = getForumComments(wb);
        const comment = {
            id: Date.now(),
            postId,
            author: session ? session.username : (author || 'Гость'),
            message,
            date: new Date().toLocaleString('ru-RU')
        };
        comments.push(comment);
        setForumComments(wb, comments);
        await saveWorkbook(wb);
        res.status(200).json(comment);
        return;
    }
    if (req.method === 'DELETE') {
        const id = (req.query && req.query.id) || (new URL(req.url, 'http://x').searchParams.get('id'));
        if (!id) {
            res.status(400).json({ error: 'id обязателен' });
            return;
        }
        const session = await requireAuth(req);
        if (!session || session.role !== 'admin') {
            res.status(403).json({ error: 'Только администратор может скрывать комментарии' });
            return;
        }
        const wb = await loadWorkbook();
        const comments = getForumComments(wb).filter((c) => String(c.id) !== String(id));
        setForumComments(wb, comments);
        await saveWorkbook(wb);
        res.status(200).json({ ok: true });
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
