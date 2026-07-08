// Объединённый эндпоинт: login / register / logout — раньше были тремя
// отдельными serverless-функциями, но бесплатный тариф Vercel ограничивает
// число функций на деплой (12), а функций в проекте стало больше — поэтому
// маршрутизируем через ?action=.
const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser, isHashedPassword, hashPassword, verifyPassword, createSession, deleteSession } = require('./_lib/store-select');

async function handleLogin(req, res) {
    const { username, password } = req.body || {};
    if (!username || !password) {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
        return;
    }
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    const found = users.find((u) => u.username === username);
    const ok = found ? await verifyPassword(password, found.password) : false;
    if (!found || !ok) {
        res.status(401).json({ error: 'Неверный логин или пароль' });
        return;
    }
    if (!isHashedPassword(found.password)) {
        found.password = await hashPassword(password);
        setUsers(wb, users);
        await saveWorkbook(wb);
    }
    const token = await createSession(found.username, found.role);
    res.status(200).json({ ...publicUser(found), token });
}

async function handleRegister(req, res) {
    const { username, password, role } = req.body || {};
    if (!username || !password) {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
        return;
    }
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    if (users.some((u) => u.username === username)) {
        res.status(409).json({ error: 'Такой логин уже занят' });
        return;
    }
    const normalizedRole = role === 'admin' ? 'admin' : 'user';
    const newUser = {
        username,
        password: await hashPassword(password),
        role: normalizedRole,
        label: normalizedRole === 'admin' ? 'Администратор' : 'Пользователь',
        builtIn: false
    };
    users.push(newUser);
    setUsers(wb, users);
    await saveWorkbook(wb);
    const token = await createSession(newUser.username, newUser.role);
    res.status(200).json({ ...publicUser(newUser), token });
}

async function handleLogout(req, res) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (token) await deleteSession(token);
    res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const action = (req.query && req.query.action) || '';
    if (action === 'login') return handleLogin(req, res);
    if (action === 'register') return handleRegister(req, res);
    if (action === 'logout') return handleLogout(req, res);
    res.status(400).json({ error: 'Неизвестное действие' });
};
