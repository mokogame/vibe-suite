CREATE TABLE IF NOT EXISTS message_mentions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('user','agent','all')),
  target_agent_id TEXT,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_mentions_message_id ON message_mentions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_mentions_conversation_id ON message_mentions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_mentions_target_user_id ON message_mentions(target_user_id);
