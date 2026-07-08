const { getTestResults, saveTestResult } = require('./_lib/store-select');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
    const session = await requireAuth(req);
    if (!session) {
        res.status(401).json({ error: 'Нужно войти в аккаунт' });
        return;
    }
    const testId = (req.query && req.query.testId) || 'stress';
    if (req.method === 'GET') {
        res.status(200).json(await getTestResults(session.username, testId));
        return;
    }
    if (req.method === 'POST') {
        const { score, status, date, timestamp } = req.body || {};
        if (typeof score !== 'number') {
            res.status(400).json({ error: 'score обязателен' });
            return;
        }
        const result = await saveTestResult(session.username, testId, score, status, date, timestamp);
        res.status(200).json(result);
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
