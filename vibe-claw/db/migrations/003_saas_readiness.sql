alter table agents add column if not exists tenant_id text not null default 'default';
alter table agents add column if not exists project_id text not null default 'default';
alter table model_providers add column if not exists tenant_id text not null default 'default';
alter table model_providers add column if not exists project_id text not null default 'default';
alter table agent_runs add column if not exists tenant_id text not null default 'default';
alter table agent_runs add column if not exists project_id text not null default 'default';
alter table agent_run_steps add column if not exists tenant_id text not null default 'default';
alter table agent_run_steps add column if not exists project_id text not null default 'default';
alter table run_events add column if not exists tenant_id text not null default 'default';
alter table run_events add column if not exists project_id text not null default 'default';
alter table api_tokens add column if not exists tenant_id text not null default 'default';
alter table api_tokens add column if not exists project_id text not null default 'default';
alter table audit_events add column if not exists tenant_id text not null default 'default';
alter table audit_events add column if not exists project_id text not null default 'default';
alter table agent_memories add column if not exists tenant_id text not null default 'default';
alter table agent_memories add column if not exists project_id text not null default 'default';
alter table agent_conversations add column if not exists tenant_id text not null default 'default';
alter table agent_conversations add column if not exists project_id text not null default 'default';
alter table agent_messages add column if not exists tenant_id text not null default 'default';
alter table agent_messages add column if not exists project_id text not null default 'default';
alter table agent_protocols add column if not exists tenant_id text not null default 'default';
alter table agent_protocols add column if not exists project_id text not null default 'default';
alter table agent_leases add column if not exists tenant_id text not null default 'default';
alter table agent_leases add column if not exists project_id text not null default 'default';
alter table run_artifacts add column if not exists tenant_id text not null default 'default';
alter table run_artifacts add column if not exists project_id text not null default 'default';
alter table compression_audits add column if not exists tenant_id text not null default 'default';
alter table compression_audits add column if not exists project_id text not null default 'default';
alter table run_queue_tasks add column if not exists tenant_id text not null default 'default';
alter table run_queue_tasks add column if not exists project_id text not null default 'default';
alter table run_queue_tasks add column if not exists locked_by text;
alter table run_queue_tasks add column if not exists lock_expires_at timestamptz;
alter table run_queue_tasks add column if not exists max_attempts integer not null default 3;
alter table run_queue_tasks add column if not exists next_run_at timestamptz;

create table if not exists idempotency_records (
  id text primary key,
  tenant_id text not null,
  project_id text not null,
  actor text not null,
  method text not null,
  path text not null,
  idempotency_key text not null,
  body_hash text not null,
  status_code integer not null,
  response_body jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  unique(tenant_id, project_id, actor, method, path, idempotency_key)
);

create table if not exists conversation_locks (
  conversation_id text primary key,
  tenant_id text not null,
  project_id text not null,
  holder text not null,
  lock_until timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists webhook_deliveries (
  id text primary key,
  tenant_id text not null,
  project_id text not null,
  run_id text not null,
  url text not null,
  status text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  status_code integer,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists usage_counters (
  id text primary key,
  tenant_id text not null,
  project_id text not null,
  token_id text,
  agent_id text,
  provider_id text,
  usage_window text not null,
  request_count integer not null default 0,
  token_count integer not null default 0,
  cost_units integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_agents_tenant_project on agents(tenant_id, project_id);
create index if not exists idx_runs_tenant_project on agent_runs(tenant_id, project_id);
create index if not exists idx_queue_claim on run_queue_tasks(status, next_run_at, lock_expires_at, created_at);
create index if not exists idx_idempotency_expires_at on idempotency_records(expires_at);
create index if not exists idx_webhook_deliveries_run on webhook_deliveries(run_id, status);
create unique index if not exists idx_usage_counters_unique_window on usage_counters(tenant_id, project_id, coalesce(token_id, ''), coalesce(agent_id, ''), coalesce(provider_id, ''), usage_window);
