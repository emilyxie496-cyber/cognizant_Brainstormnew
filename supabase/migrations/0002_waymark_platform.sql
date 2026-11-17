-- Waymark 3.0: integrations, agent runs, risk alerts, notifications and approvals.
-- Run after 0001. Every table carries company_id and has row-level security on.
--
-- These tables are written only by the Waymark API, using the service role
-- (SUPABASE_SERVICE_ROLE_KEY). Members can read their own company's rows
-- directly, with two exceptions that no client role can read at all:
--   integration_connections  holds sealed credentials
--   integration_datasets     holds sealed copies of synced business records
-- The API returns their status and contents after its own access checks.
--
-- Shape: (company_id, id) identifies a row. `details` holds the full record;
-- the promoted columns exist to be indexed and filtered.

create table public.integration_connections (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  provider text,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.integration_datasets (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  provider text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.integration_sync_jobs (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  provider text,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.external_record_mappings (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  provider text,
  external_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.integration_events (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  provider text,
  event_type text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.agent_runs (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  status text,
  trigger text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.agent_tool_calls (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  run_id text,
  tool text,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create index agent_tool_calls_run_idx on public.agent_tool_calls (company_id, run_id);

-- dedupe_key is what makes monitoring idempotent: one alert per key per company.
create table public.risk_alerts (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  dedupe_key text,
  category text,
  level text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create unique index risk_alerts_dedupe_idx on public.risk_alerts (company_id, dedupe_key);

create table public.notification_preferences (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  channel text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.notification_deliveries (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  channel text,
  status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

create table public.approval_requests (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  status text,
  action_type text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);
create index approval_requests_status_idx on public.approval_requests (company_id, status);

create table public.platform_settings (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

-- Row-level security on every table. With no policy, a table is closed to client roles.
do $$
declare
  t text;
  readable text[] := array[
    'integration_sync_jobs', 'external_record_mappings', 'integration_events', 'agent_runs', 'agent_tool_calls',
    'risk_alerts', 'notification_preferences', 'notification_deliveries', 'approval_requests', 'platform_settings'
  ];
  sealed text[] := array['integration_connections', 'integration_datasets'];
begin
  foreach t in array readable || sealed loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array readable loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.is_company_member(company_id))$p$, t || '_read', t);
  end loop;
end $$;
