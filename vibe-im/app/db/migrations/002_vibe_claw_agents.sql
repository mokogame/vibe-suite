CREATE TABLE IF NOT EXISTS vibe_claw_agents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_model TEXT,
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vibe_claw_conversation_links (
  id TEXT PRIMARY KEY,
  im_conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  claw_agent_id TEXT NOT NULL,
  claw_conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vibe_claw_agents_user_id ON vibe_claw_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_vibe_claw_links_agent_id ON vibe_claw_conversation_links(claw_agent_id);
