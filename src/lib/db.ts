export interface Env {
  DB: D1Database;
  PRODUCT_SLUG: string;
  SOURCE_URL: string;
}

export async function ensureSchema(db: D1Database) {
  // Idempotent guard for the auth+usage tables. Migrations remain the source of truth.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      monthly_quota INTEGER NOT NULL DEFAULT 100,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS usage (
      key TEXT NOT NULL,
      month TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, month)
    )`),
  ]);
}

export interface ApiKeyRow {
  key: string;
  tier: string;
  monthly_quota: number;
  revoked_at: string | null;
}

export async function getKey(db: D1Database, key: string): Promise<ApiKeyRow | null> {
  return db
    .prepare("SELECT key, tier, monthly_quota, revoked_at FROM api_keys WHERE key = ?")
    .bind(key)
    .first<ApiKeyRow>();
}

export function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function incrementAndCheck(
  db: D1Database,
  key: string,
  quota: number,
): Promise<{ ok: boolean; count: number }> {
  const month = thisMonth();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO usage (key, month, count) VALUES (?, ?, 1)
         ON CONFLICT (key, month) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(key, month),
  ]);
  const row = (result[0].results as { count: number }[])[0];
  return { ok: row.count <= quota, count: row.count };
}
