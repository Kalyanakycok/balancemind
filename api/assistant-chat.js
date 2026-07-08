// Проксирует чат-виджет сайта в Anthropic Messages API. Ключ читается из
// process.env.ANTHROPIC_API_KEY (задаётся в .env.local локально и через
// `vercel env add ANTHROPIC_API_KEY` в проекте на Vercel).

const SYSTEM_PROMPT = `Ты — ИИ-ассистент сайта BalanceMind, посвящённого психологическому здоровью и управлению стрессом.
Отвечай по-русски, тепло и поддерживающе, но по делу — без воды.

Ты знаешь о возможностях сайта и можешь направлять туда пользователя:
— тест на уровень стресса (страница «Тест на стресс»);
— личный дневник настроения и заметок;
— практики (дыхательные упражнения, техники расслабления);
— статьи о стрессе и психологическом благополучии;
— форум сообщества, где можно обсудить свою ситуацию с другими;
— раздел «Советы» с формой обращения к специалисту.

Важные ограничения:
— Ты не заменяешь профессионального психолога или психиатра и не ставишь диагнозы.
— Если пользователь описывает кризисное состояние, мысли о самоповреждении или острую тревогу —
  мягко, без паники, порекомендуй немедленно обратиться к специалисту или на горячую линию
  психологической помощи, и укажи на раздел сайта «Обращение к специалисту».
— Отвечай кратко (обычно 2-5 предложений), если пользователь явно не просит подробностей.`;

const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = 512;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        res.status(503).json({ error: 'Ассистент ещё не настроен: не задан ANTHROPIC_API_KEY.' });
        return;
    }
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages обязателен' });
        return;
    }

    const trimmed = messages.slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000)
    }));

    try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: SYSTEM_PROMPT,
                messages: trimmed
            })
        });
        const data = await apiRes.json();
        if (!apiRes.ok) {
            res.status(502).json({ error: data.error?.message || 'Ошибка при обращении к ассистенту.' });
            return;
        }
        const reply = (data.content || []).map((block) => block.text || '').join('').trim() || 'Не удалось сформировать ответ.';
        res.status(200).json({ reply });
    } catch (err) {
        res.status(502).json({ error: 'Ассистент временно недоступен.' });
    }
};
