CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS last_synced_at TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS last_error TEXT;
