create index if not exists idx_agents_status_created_at on agents(status, created_at);
create index if not exists idx_agent_runs_status_created_at on agent_runs(status, created_at desc);
create index if not exists idx_agent_run_steps_run_id on agent_run_steps(run_id);
create index if not exists idx_run_events_run_id_created_at on run_events(run_id, created_at);
create index if not exists idx_audit_events_request_id on audit_events(request_id);
create index if not exists idx_audit_events_target on audit_events(target_type, target_id, created_at desc);
create index if not exists idx_api_tokens_status_created_at on api_tokens(status, created_at desc);

create table if not exists model_providers (
  id text primary key,
  name text not null,
  type text not null,
  status text not null,
  base_url text,
  default_model text not null,
  api_key_ref text,
  timeout_ms integer not null default 30000,
  max_retries integer not null default 2,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_model_providers_status_created_at on model_providers(status, created_at);

create table if not exists agent_memories (
  id text primary key,
  agent_id text not null references agents(id),
  type text not null,
  scope text not null,
  status text not null,
  summary text not null,
  content text not null,
  source text not null,
  source_run_id text,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists agent_conversations (
  id text primary key,
  agent_id text not null references agents(id),
  mode text not null,
  status text not null,
  summary text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists agent_messages (
  id text primary key,
  conversation_id text not null references agent_conversations(id),
  agent_id text not null references agents(id),
  role text not null,
  content text not null,
  run_id text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null
);

create table if not exists agent_protocols (
  id text primary key,
  agent_id text not null references agents(id),
  name text not null,
  version text not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(agent_id, name, version)
);

create table if not exists agent_leases (
  id text primary key,
  agent_id text not null references agents(id),
  status text not null,
  expires_at timestamptz not null,
  max_calls integer not null,
  used_calls integer not null default 0,
  token_budget integer not null,
  used_tokens integer not null default 0,
  allowed_protocols text not null,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists run_artifacts (
  id text primary key,
  run_id text not null references agent_runs(id),
  type text not null,
  name text not null,
  content text not null,
  created_at timestamptz not null
);

create table if not exists compression_audits (
  id text primary key,
  run_id text,
  strategy text not null,
  strategy_version text not null,
  original_tokens integer not null,
  compressed_tokens integer not null,
  kept jsonb not null,
  summarized jsonb not null,
  dropped jsonb not null,
  created_at timestamptz not null
);

create table if not exists model_configs (
  id text primary key,
  provider_id text references model_providers(id),
  model_name text not null,
  context_window integer not null default 8192,
  default_temperature numeric not null default 0.2,
  max_output_tokens integer not null default 2048,
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists agent_versions (
  id text primary key,
  agent_id text not null references agents(id),
  version integer not null,
  instruction text not null,
  default_model text not null,
  created_at timestamptz not null
);

create table if not exists agent_run_contexts (
  id text primary key,
  run_id text not null references agent_runs(id),
  source text not null,
  content_summary text not null,
  token_count integer not null default 0,
  created_at timestamptz not null
);

create table if not exists run_queue_tasks (
  id text primary key,
  run_id text not null references agent_runs(id),
  status text not null,
  request_id text not null,
  actor jsonb not null,
  input jsonb not null,
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_agent_memories_agent_status on agent_memories(agent_id, status, created_at desc);
create index if not exists idx_agent_conversations_agent_updated on agent_conversations(agent_id, updated_at desc);
create index if not exists idx_agent_messages_conversation_created on agent_messages(conversation_id, created_at);
create index if not exists idx_agent_protocols_agent_status on agent_protocols(agent_id, status);
create index if not exists idx_agent_leases_agent_status on agent_leases(agent_id, status);
create index if not exists idx_run_artifacts_run_id on run_artifacts(run_id);
create index if not exists idx_compression_audits_run_id on compression_audits(run_id, created_at desc);
create index if not exists idx_model_configs_provider_status on model_configs(provider_id, status);
create index if not exists idx_agent_versions_agent_version on agent_versions(agent_id, version desc);
create index if not exists idx_agent_run_contexts_run_id on agent_run_contexts(run_id);
create index if not exists idx_run_queue_tasks_status_created_at on run_queue_tasks(status, created_at);

alter table agents add column if not exists provider_id text;
create index if not exists idx_agents_provider_id on agents(provider_id);
