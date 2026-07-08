const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser, hashPassword, createSession } = require('./_lib/store-select');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
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
};
