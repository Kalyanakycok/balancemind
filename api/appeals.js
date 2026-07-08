const { loadWorkbook, saveWorkbook, getAppeals, setAppeals } = require('./_lib/store-select');

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const wb = await loadWorkbook();
        res.status(200).json(getAppeals(wb));
        return;
    }
    if (req.method === 'POST') {
        const { from, subject, message } = req.body || {};
        if (!subject || !message) {
            res.status(400).json({ error: 'Тема и сообщение обязательны' });
            return;
        }
        const wb = await loadWorkbook();
        const appeals = getAppeals(wb);
        const appeal = {
            id: Date.now(),
            from: from || 'Гость',
            subject,
            message,
            date: new Date().toLocaleString('ru-RU')
        };
        appeals.push(appeal);
        setAppeals(wb, appeals);
        await saveWorkbook(wb);
        res.status(200).json(appeal);
        return;
    }
    res.status(405).json({ error: 'Method not allowed' });
};
