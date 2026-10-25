// Couche base de données : Postgres (production, via DATABASE_URL) ou SQLite local (développement / tests).
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    trial_end BIGINT NOT NULL,
    stripe_customer TEXT,
    stripe_sub TEXT,
    plan TEXT,
    status TEXT NOT NULL DEFAULT 'trial',
    period_end BIGINT NOT NULL DEFAULT 0,
    pass_until BIGINT NOT NULL DEFAULT 0,
    remind_on INTEGER NOT NULL DEFAULT 0,
    remind_time TEXT NOT NULL DEFAULT '18:00',
    tz TEXT NOT NULL DEFAULT 'Europe/Paris',
    last_push_day TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS states(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS resets(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS push_subs(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events(
    id TEXT PRIMARY KEY,
    at BIGINT NOT NULL
  )`,
];

export async function openDb({ url = process.env.DATABASE_URL, file = process.env.SQLITE_FILE || './data/tendra.db' } = {}) {
  let db;
  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number
    const pool = new pg.Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    });
    db = { kind: 'pg', q: async (sql, p = []) => (await pool.query(sql, p)).rows, close: () => pool.end() };
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA foreign_keys=ON;');
    if (file !== ':memory:') raw.exec('PRAGMA journal_mode=WAL;');
    db = {
      kind: 'sqlite',
      q: async (sql, p = []) => {
        const s = sql.replace(/\$(\d+)/g, '?$1');
        const st = raw.prepare(s);
        if (/^\s*(select|with|pragma)/i.test(s) || /returning/i.test(s)) return st.all(...p);
        st.run(...p);
        return [];
      },
      close: () => raw.close(),
    };
  }
  for (const stmt of SCHEMA) await db.q(stmt);
  return db;
}
