CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    monthly_quota INTEGER NOT NULL DEFAULT 100,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS usage (
    key TEXT NOT NULL,
    month TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_month ON usage(month);
