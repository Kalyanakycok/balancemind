const { loadWorkbook, saveWorkbook, getUsers, setUsers, publicUser, isHashedPassword, hashPassword, verifyPassword, createSession } = require('./_lib/store-select');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
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
    // Мягкая миграция: если пароль ещё хранился в открытом виде, хешируем его сейчас.
    if (!isHashedPassword(found.password)) {
        found.password = await hashPassword(password);
        setUsers(wb, users);
        await saveWorkbook(wb);
    }
    const token = await createSession(found.username, found.role);
    res.status(200).json({ ...publicUser(found), token });
};
