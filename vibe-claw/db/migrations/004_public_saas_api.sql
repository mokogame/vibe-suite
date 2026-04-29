alter table api_tokens add column if not exists expires_at timestamptz;
alter table api_tokens add column if not exists allowed_ips text not null default '';
alter table api_tokens add column if not exists last_used_at timestamptz;
alter table api_tokens add column if not exists last_used_ip text;

create table if not exists webhook_subscriptions (
  id text primary key,
  tenant_id text not null,
  project_id text not null,
  name text not null,
  url text not null,
  secret_ref text,
  event_types text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_api_tokens_lifecycle on api_tokens(status, expires_at, last_used_at);
create index if not exists idx_webhook_subscriptions_scope on webhook_subscriptions(tenant_id, project_id, status);
