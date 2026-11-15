-- ═══════════════════════════════════════════════════════════════════════════
-- Batch 2: sequences that run, scheduled jobs, the desk's visit index,
-- geotag check-ins, post-visit feedback, buyer link tokens. Sales state only.
-- RLS on, no policies, grants revoked — server (secret key) only. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0001 created `sequences` for Batch 1's planned shape; widen it.
alter table public.sequences add column if not exists trigger text;
alter table public.sequences add column if not exists params jsonb not null default '{}'::jsonb;
alter table public.sequences add column if not exists active boolean not null default true;
alter table public.sequences add column if not exists stop_on_reply boolean not null default true;
alter table public.sequences add column if not exists updated_at timestamptz;
alter table public.sequences drop constraint if exists sequences_status_check;
alter table public.sequences alter column status drop not null;

create table if not exists public.sequence_runs (
  id text primary key,
  sequence_id text not null,
  lead_id text not null,
  started_at timestamptz not null,
  anchor_at timestamptz not null,
  visit_id text,
  status text not null check (status in ('active','completed','stopped')),
  stop_reason text
);
create index if not exists sequence_runs_lead on public.sequence_runs (lead_id, status);

create table if not exists public.jobs (
  id text primary key,
  lead_id text not null,
  run_id text,
  sequence_id text,
  step_index integer,
  channel text not null check (channel in ('in_app','whatsapp','sms','email')),
  template text not null,
  body text,
  run_at timestamptz not null,
  status text not null check (status in ('pending','running','sent','pending_twilio','skipped','cancelled','failed')),
  note text,
  premium_message_id text,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  source text not null
);
create index if not exists jobs_due on public.jobs (status, run_at);
create index if not exists jobs_lead on public.jobs (lead_id, run_at);

create table if not exists public.visit_records (
  visit_id text primary key,
  lead_id text not null,
  property_id text not null,
  slot timestamptz not null,
  status text not null check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visit_records_property on public.visit_records (property_id, slot);

create table if not exists public.check_ins (
  id text primary key,
  visit_id text not null,
  lead_id text not null,
  by text not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  at timestamptz not null,
  distance_m double precision not null,
  on_site boolean not null
);

create table if not exists public.feedback (
  id text primary key,
  visit_id text not null,
  lead_id text not null,
  interest text not null check (interest in ('interested','maybe','not_interested')),
  objections jsonb not null default '[]'::jsonb,
  rating integer check (rating between 1 and 5),
  comment text not null default '',
  at timestamptz not null,
  actions jsonb not null default '[]'::jsonb
);

create table if not exists public.link_tokens (
  token text primary key,
  purpose text not null check (purpose in ('book','visit','feedback')),
  lead_id text not null,
  visit_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['sequence_runs','jobs','visit_records','check_ins','feedback','link_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
