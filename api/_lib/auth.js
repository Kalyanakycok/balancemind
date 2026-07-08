const { getSession } = require('./store-select');

// Достаёт токен из заголовка Authorization: Bearer <token> и резолвит его в
// { username, role } через сессию на сервере. Никогда не доверяем полю
// username/author, присланному в теле запроса — только этому.
async function requireAuth(req) {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return null;
    return getSession(token);
}

module.exports = { requireAuth };
