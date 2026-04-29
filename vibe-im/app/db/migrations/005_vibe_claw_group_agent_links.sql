ALTER TABLE vibe_claw_conversation_links
  DROP CONSTRAINT IF EXISTS vibe_claw_conversation_links_im_conversation_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vibe_claw_links_im_agent_unique
  ON vibe_claw_conversation_links (im_conversation_id, claw_agent_id);
