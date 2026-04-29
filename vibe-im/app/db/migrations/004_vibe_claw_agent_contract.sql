ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS contract_json TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS mission TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS style TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS output_contract TEXT;
ALTER TABLE vibe_claw_agents ADD COLUMN IF NOT EXISTS boundaries_json TEXT;
