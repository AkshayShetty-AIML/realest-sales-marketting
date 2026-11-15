-- ═══════════════════════════════════════════════════════════════════════════
-- Marketing agentic harness (lib/marketing/harness). Company / operator level:
-- every row belongs to a WORKSPACE (one builder company's marketing).
--
-- TENANT ISOLATION: every scoped table's primary key is (workspace_id, id)
-- and every query the server makes filters by workspace_id
-- (lib/marketing/harness/store.ts → ScopedStore). Rows are the TypeScript
-- objects in `data`; status / kind / goal_id / sort_at are lifted out for
-- filtering and ordering.
--
-- SECURITY: RLS ON, NO policies, grants revoked from anon/authenticated —
-- only this app's server (secret key) reads or writes. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  enabled boolean not null default false,
  autonomy text not null default 'suggest-only'
    check (autonomy in ('suggest-only','approve-each','autonomous-within-guardrails')),
  members jsonb not null default '[]'::jsonb,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['goals','tasks','subagent_runs','tool_registry','approvals','audit_log','checkpoints','schedules','memory_items','notifications'] loop
    execute format($f$
      create table if not exists public.%I (
        workspace_id text not null references public.workspaces(id) on delete cascade,
        id text not null,
        status text,
        kind text,
        goal_id text,
        sort_at timestamptz not null default now(),
        data jsonb not null,
        primary key (workspace_id, id)
      )$f$, t);
    execute format('create index if not exists %I on public.%I (workspace_id, sort_at)', t || '_ws_time', t);
    execute format('create index if not exists %I on public.%I (workspace_id, status)', t || '_ws_status', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

create index if not exists tasks_goal on public.tasks (workspace_id, goal_id);
create index if not exists subagent_runs_goal on public.subagent_runs (workspace_id, goal_id);
create index if not exists memory_items_kind on public.memory_items (workspace_id, kind);
create index if not exists audit_log_kind on public.audit_log (workspace_id, kind, sort_at);

-- The automation engine's one cross-workspace read: due cron schedules.
alter table public.schedules add column if not exists next_run_at timestamptz;
alter table public.schedules add column if not exists trigger_kind text;
create index if not exists schedules_due on public.schedules (status, trigger_kind, next_run_at);

-- Approvals resolve exactly once: the server PATCHes with status=eq.pending,
-- so a second decision matches no row.

alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon, authenticated;
