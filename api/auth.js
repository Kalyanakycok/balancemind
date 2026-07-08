// Объединённый эндпоинт: login / register / logout — раньше были тремя
// отдельными serverless-функциями, но бесплатный тариф Vercel ограничивает
// число функций на деплой (12), а функций в проекте стало больше — поэтому
// маршрутизируем через ?action=.
const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser, isHashedPassword, hashPassword, verifyPassword, createSession, deleteSession } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

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
    const { username, password } = req.body || {};
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
    // Публичная регистрация ВСЕГДА создаёт обычного пользователя. Роль admin
    // клиент раньше мог прислать сам в теле запроса — любой мог зарегистрироваться
    // администратором без единой проверки. Повысить роль теперь может только
    // уже залогиненный админ через PATCH /api/users (см. api/users.js).
    const newUser = {
        username,
        password: await hashPassword(password),
        role: 'user',
        label: 'Пользователь',
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

// Смена пароля для своего же аккаунта — нужно знать текущий пароль. Это не
// «забыл пароль» (email-инфраструктуры на сайте нет), а сознательная смена
// залогиненным пользователем. Восстановление ЗАБЫТОГО пароля — через админа
// (см. api/admin.js, action=reset-password).
async function handleChangePassword(req, res) {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Текущий и новый пароль обязательны' });
        return;
    }
    if (newPassword.length < 6) {
        res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' });
        return;
    }
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    const found = users.find((u) => u.username === session.username);
    const ok = found ? await verifyPassword(currentPassword, found.password) : false;
    if (!ok) {
        res.status(401).json({ error: 'Текущий пароль указан неверно' });
        return;
    }
    found.password = await hashPassword(newPassword);
    setUsers(wb, users);
    await saveWorkbook(wb);
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
    if (action === 'change-password') return handleChangePassword(req, res);
    res.status(400).json({ error: 'Неизвестное действие' });
};
