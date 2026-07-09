-- BalanceMind: схема Postgres (альтернатива хранению в Excel/Vercel Blob).
-- Выполнить один раз на новой базе (Vercel Postgres, Neon, Supabase и т.п.) —
-- например через SQL-редактор в консоли провайдера, либо:
--   psql "$POSTGRES_URL" -f schema.sql
--
-- Заметка: store-postgres.js умеет создать эти таблицы сам при первом
-- обращении (CREATE TABLE IF NOT EXISTS), так что ручной прогон этого файла
-- не обязателен — он просто нагляден и удобен для ревью структуры данных.

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,        -- bcrypt-хеш
    role        TEXT NOT NULL DEFAULT 'user',
    label       TEXT NOT NULL DEFAULT '',
    built_in    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS appeals (
    id          TEXT PRIMARY KEY,
    "from"      TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS forum_posts (
    id          TEXT PRIMARY KEY,
    author      TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS forum_comments (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_forum_comments_post_id ON forum_comments(post_id);

-- Сид-аккаунты (admin/admin123, user/user123, Potap/admin123) создаются
-- автоматически при первом вызове loadWorkbook() в store-postgres.js —
-- их пароли хешируются bcrypt'ом на лету (со случайной солью), поэтому
-- готовых INSERT для users здесь намеренно нет.

-- ---------------------------------------------------------------------
-- Токены сессий и личные данные пользователей (дневник, чек-лист,
-- настроение, план дня, история теста на стресс, прочитанные уведомления).
-- Раньше всё это лежало в localStorage браузера под общими ключами без
-- привязки к аккаунту — из-за этого разные пользователи на одном браузере
-- видели чужие данные. Теперь всё привязано к username через сессию,
-- которую сервер сам проверяет (клиент не может подделать identity).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);

CREATE TABLE IF NOT EXISTS journal_entries (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    mood        TEXT NOT NULL DEFAULT '',
    liked       BOOLEAN NOT NULL DEFAULT FALSE,
    likes       INTEGER NOT NULL DEFAULT 0,
    date        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_username ON journal_entries(username);

CREATE TABLE IF NOT EXISTS checklist_items (
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    task        TEXT NOT NULL,
    checked     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (username, task)
);

CREATE TABLE IF NOT EXISTS mood_logs (
    username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    mood        TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_plans (
    username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    state       JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_results (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    test_id     TEXT NOT NULL DEFAULT 'stress',
    score       INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL DEFAULT '',
    timestamp   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_results_username ON test_results(username, test_id);

CREATE TABLE IF NOT EXISTS notif_read (
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    notif_id    TEXT NOT NULL,
    PRIMARY KEY (username, notif_id)
);

-- ---------------------------------------------------------------------
-- Личная переписка пользователя с персоналом (администратор / психолог).
-- В отличие от ИИ-ассистента (api/assistant-chat.js, без хранения) это
-- полноценный двусторонний диалог: пользователь пишет, персонал отвечает,
-- история сохраняется. Тред определяется парой (username, channel), где
-- channel — 'admin' или 'psychologist'. sender — 'user' или 'staff'.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    channel     TEXT NOT NULL DEFAULT 'admin',    -- 'admin' | 'psychologist'
    sender      TEXT NOT NULL DEFAULT 'user',     -- 'user' | 'staff'
    author      TEXT NOT NULL DEFAULT '',         -- отображаемое имя отправителя
    text        TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(username, channel, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, created_at);

-- Контрольное слово для самостоятельного восстановления пароля (без почты).
-- Хранится bcrypt-хешем, как и пароль, — прочитать его нельзя, можно только
-- проверить при восстановлении. Отдельная таблица, чтобы не трогать логику
-- сохранения users (persistUsers перезаписывает строки целиком).
CREATE TABLE IF NOT EXISTS password_recovery (
    username    TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    word_hash   TEXT NOT NULL
);
