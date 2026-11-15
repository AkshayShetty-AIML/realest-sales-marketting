-- ═══════════════════════════════════════════════════════════════════════════
-- Sales-automation app — its OWN Supabase project (not the premium one).
-- Sales/automation state only, keyed by PREMIUM lead ids. Leads, messages,
-- visits and inventory stay in the premium app and are read via its
-- /api/internal/* API. Idempotent.
--
-- SECURITY: RLS ON for every table and NO policies, grants revoked from
-- anon/authenticated. Only this app's server (secret key) reads or writes;
-- the browser never talks to this database. Reps reach data only through
-- server components / server actions after Clerk sign-in.
-- Column names are lib/store/types.ts fields in snake_case.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.reps (
  id text primary key,
  name text not null,
  email text not null,
  localities jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  clerk_user_id text unique
);

create table if not exists public.assignments (
  id text primary key,
  lead_id text not null,
  rep_id text not null references public.reps(id),
  assigned_at timestamptz not null default now(),
  assigned_by text not null,
  reason text not null default ''
);
create index if not exists assignments_lead on public.assignments (lead_id, assigned_at);

create table if not exists public.opt_ins (
  lead_id text primary key,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  status text not null check (status in ('opted_in','opted_out')),
  source text not null,
  recorded_at timestamptz not null default now(),
  simulated boolean not null default false
);

-- One row per lead: the primary key IS the idempotency lock for auto-reply.
create table if not exists public.auto_replies (
  lead_id text primary key,
  outcome text not null check (outcome in ('sent','handoff','failed')),
  channel text not null check (channel in ('whatsapp','in_app')),
  engine text not null check (engine in ('llm','template')),
  body text not null,
  fact_keys jsonb not null default '[]'::jsonb,
  handoff_reason text,
  provider_id text,
  simulated boolean not null default false,
  at timestamptz not null default now()
);

create table if not exists public.conversations (
  lead_id text primary key,
  mode text not null default 'ai' check (mode in ('ai','human')),
  taken_over_by text,
  taken_over_at timestamptz
);

-- Inbound WhatsApp (premium's API logs OUTBOUND only).
create table if not exists public.inbound_messages (
  id text primary key,
  lead_id text not null,
  channel text not null default 'whatsapp',
  body text not null,
  provider_id text,
  received_at timestamptz not null default now(),
  simulated boolean not null default false
);
create index if not exists inbound_lead on public.inbound_messages (lead_id, received_at);

-- Peppered SHA-256 of a buyer phone → lead. No raw phone number is stored.
create table if not exists public.contact_index (
  phone_hash text primary key,
  lead_id text not null
);

create table if not exists public.sequences (
  id text primary key,
  name text not null,
  status text not null default 'planned' check (status in ('planned')),
  steps jsonb not null default '[]'::jsonb
);

create table if not exists public.audit_events (
  id text primary key,
  at timestamptz not null default now(),
  kind text not null,
  lead_id text,
  actor text not null,
  detail text not null
);
create index if not exists audit_lead on public.audit_events (lead_id, at desc);

create table if not exists public.cursors (
  name text primary key,
  value text not null
);

do $$
declare t text;
begin
  foreach t in array array['reps','assignments','opt_ins','auto_replies','conversations','inbound_messages',
                           'contact_index','sequences','audit_events','cursors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
