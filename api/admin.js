// Админ-эндпоинт: обзор всех пользователей (тесты + дневник), сброс пароля,
// удаление аккаунта. Всё требует активной сессии с role === 'admin' —
// обычный пользователь получает 403 на любое действие здесь.
const { getUsers, hashPassword, adminGetUsersOverview, adminSetPassword, adminDeleteUser } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

function genTempPassword() {
    return require('crypto').randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session || session.role !== 'admin') {
        res.status(403).json({ error: 'Доступно только администратору' });
        return;
    }

    const action = (req.query && req.query.action) || '';

    if (action === 'overview' && req.method === 'GET') {
        const overview = await adminGetUsersOverview();
        res.status(200).json(overview);
        return;
    }

    if (action === 'reset-password' && req.method === 'POST') {
        const { username, newPassword } = req.body || {};
        if (!username) {
            res.status(400).json({ error: 'username обязателен' });
            return;
        }
        const tempPassword = newPassword || genTempPassword();
        const ok = await adminSetPassword(username, await hashPassword(tempPassword));
        if (!ok) {
            res.status(404).json({ error: 'Пользователь не найден' });
            return;
        }
        res.status(200).json({ ok: true, newPassword: tempPassword });
        return;
    }

    if (action === 'delete-user' && req.method === 'DELETE') {
        const username = (req.query && req.query.username) || (req.body && req.body.username);
        if (!username) {
            res.status(400).json({ error: 'username обязателен' });
            return;
        }
        if (username === session.username) {
            res.status(400).json({ error: 'Нельзя удалить собственный аккаунт, пока вы в него вошли' });
            return;
        }
        const ok = await adminDeleteUser(username);
        if (!ok) {
            res.status(404).json({ error: 'Пользователь не найден' });
            return;
        }
        res.status(200).json({ ok: true });
        return;
    }

    res.status(400).json({ error: 'Неизвестное действие' });
};
