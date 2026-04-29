alter table agents add column if not exists contract jsonb not null default '{}'::jsonb;

alter table agent_memories add column if not exists importance double precision not null default 0.75;
alter table agent_memories add column if not exists confidence double precision not null default 0.75;
alter table agent_memories add column if not exists tags text not null default '';
alter table agent_memories add column if not exists provenance text not null default 'unknown';
alter table agent_memories add column if not exists expires_at timestamptz;
alter table agent_memories add column if not exists last_accessed_at timestamptz;

create index if not exists idx_agent_memories_retrieval on agent_memories(agent_id, status, importance desc, updated_at desc);
