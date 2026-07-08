// Автоматически выбирает бэкенд хранения данных BalanceMind:
//   - Postgres (store-postgres.js), если в окружении задана POSTGRES_URL
//     или DATABASE_URL — это происходит само собой после того, как в
//     Vercel-проекте подключена база (например, командой `vercel install neon`,
//     через Vercel Postgres, или вручную указанной переменной окружения);
//   - иначе — прежнее хранилище на Vercel Blob + Excel (store.js).
//
// Все api/*.js файлы импортируют именно этот модуль, а не store.js напрямую,
// поэтому подключение Postgres не требует правок кода — только переменную
// окружения в настройках проекта на Vercel и (опционально) прогон schema.sql.

module.exports = (process.env.POSTGRES_URL || process.env.DATABASE_URL)
    ? require('./store-postgres')
    : require('./store');
