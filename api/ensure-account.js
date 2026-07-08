const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser, hashPassword, createSession } = require('./_lib/store-select');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { username, password, role, label } = req.body || {};
    if (!username || !password) {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
        return;
    }
    const wb = await loadWorkbook();
    const users = getUsers(wb);
    let account = users.find((u) => u.username === username);
    if (!account) {
        account = { username, password: await hashPassword(password), role: role === 'admin' ? 'admin' : 'user', label: label || 'Пользователь', builtIn: false };
        users.push(account);
        setUsers(wb, users);
        await saveWorkbook(wb);
    }
    const token = await createSession(account.username, account.role);
    res.status(200).json({ ...publicUser(account), token });
};
