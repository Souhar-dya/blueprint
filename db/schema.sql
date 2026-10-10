-- Blueprint keeps only what it truly needs. Interview history and custom
-- scenarios now live entirely in the browser (downloadable documents, local
-- history). This database stores analytics/monitoring events and the accounts
-- that guard the monitoring console. The obsolete session tables are dropped
-- so storage stays small.

drop table if exists interview_turns;
drop table if exists interview_sessions;
drop table if exists custom_scenarios;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
-- Idempotent migration for databases created before roles existed.
alter table app_users add column if not exists role text not null default 'user';

create table if not exists analytics_events (
  id bigserial primary key,
  user_id uuid references app_users(id) on delete set null,
  event_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_created_idx on analytics_events(event_name, created_at desc);
create index if not exists analytics_events_created_idx on analytics_events(created_at);