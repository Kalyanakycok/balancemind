const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const wb = await loadWorkbook();
        res.status(200).json(getUsers(wb).map(publicUser));
        return;
    }

    // Смена роли пользователя (admin <-> user) — только для уже залогиненного
    // администратора. Это единственный способ сделать кого-то админом теперь,
    // что закрывает баг, из-за которого им мог назначить себя кто угодно через
    // регистрацию (см. комментарий в api/auth.js).
    if (req.method === 'PATCH') {
        const session = await requireAuth(req);
        if (!session || session.role !== 'admin') {
            res.status(403).json({ error: 'Только администратор может менять роли' });
            return;
        }
        const { username, role, label } = req.body || {};
        if (!username || (role !== 'admin' && role !== 'user')) {
            res.status(400).json({ error: 'username и role (admin|user) обязательны' });
            return;
        }
        if (label !== undefined && (typeof label !== 'string' || label.length > 40)) {
            res.status(400).json({ error: 'label должен быть строкой до 40 символов' });
            return;
        }
        const wb = await loadWorkbook();
        const users = getUsers(wb);
        const target = users.find((u) => u.username === username);
        if (!target) {
            res.status(404).json({ error: 'Пользователь не найден' });
            return;
        }
        target.role = role;
        // Свою подпись можно задать явно (например «Главный администратор»),
        // иначе — обычный дефолт по роли.
        target.label = label ? label.trim() : (role === 'admin' ? 'Администратор' : 'Пользователь');
        setUsers(wb, users);
        await saveWorkbook(wb);
        res.status(200).json(publicUser(target));
        return;
    }

    res.status(405).json({ error: 'Method not allowed' });
};
