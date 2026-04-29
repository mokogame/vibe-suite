create table agents (
  id text primary key,
  name text not null,
  description text not null default '',
  instruction text not null,
  status text not null,
  default_model text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table agent_runs (
  id text primary key,
  status text not null,
  input text not null,
  output text,
  total_tokens integer not null default 0,
  error_type text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table agent_run_steps (
  id text primary key,
  run_id text not null references agent_runs(id),
  agent_id text not null references agents(id),
  status text not null,
  input text not null,
  output text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz
);

create table run_events (
  id text primary key,
  run_id text not null references agent_runs(id),
  step_id text,
  status text not null,
  title text not null,
  summary text not null,
  visible boolean not null default true,
  created_at timestamptz not null
);

create table api_tokens (
  id text primary key,
  token_hash text not null unique,
  name text not null,
  scopes text not null,
  status text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create table audit_events (
  id text primary key,
  request_id text not null,
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);
