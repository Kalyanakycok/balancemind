const { loadWorkbook, saveWorkbook, getForumPosts, setForumPosts, getForumComments, setForumComments } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const wb = await loadWorkbook();
        res.status(200).json(getForumPosts(wb));
        return;
    }
    if (req.method === 'POST') {
        const { author, title, message } = req.body || {};
        if (!title || !message) {
            res.status(400).json({ error: 'Тема и сообщение обязательны' });
            return;
        }
        const session = await requireAuth(req);
        const wb = await loadWorkbook();
        const posts = getForumPosts(wb);
        const post = {
            id: Date.now(),
            // Автор берётся из серверной сессии, если пользователь залогинен —
            // клиентское поле author больше не может подделать чужую личность.
            author: session ? session.username : (author || 'Гость'),
            title,
            message,
            date: new Date().toLocaleString('ru-RU')
        };
        posts.push(post);
        setForumPosts(wb, posts);
        await saveWorkbook(wb);
        res.status(200).json(post);
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
            res.status(403).json({ error: 'Только администратор может скрывать темы' });
            return;
        }
        const wb = await loadWorkbook();
        const posts = getForumPosts(wb).filter((p) => String(p.id) !== String(id));
        const comments = getForumComments(wb).filter((c) => String(c.postId) !== String(id));
        setForumPosts(wb, posts);
        setForumComments(wb, comments);
        await saveWorkbook(wb);
        res.status(200).json({ ok: true });
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
