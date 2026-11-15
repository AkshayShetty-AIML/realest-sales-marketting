-- ═══════════════════════════════════════════════════════════════════════════
-- Batch S1 wave 2: time to first reply per lead (a pointer and timestamps —
-- no lead data; the lead stays in premium's shared leads store) and builder
-- "Tell me when it's ready" interest on the Services page. RLS on, no
-- policies, grants revoked — server (secret key) only. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.first_replies (
  lead_id text primary key,
  arrived_at timestamptz not null,
  first_reply_at timestamptz,
  ms bigint,
  path text check (path in ('auto_first_reply','instant_reply','approved_draft','rep_reply')),
  status text not null check (status in ('replied','awaiting_approval','blocked')),
  types jsonb not null default '[]'::jsonb,
  note text,
  workspace_id text,
  campaign_id text,
  alerted_at timestamptz
);
create index if not exists first_replies_arrived on public.first_replies (arrived_at desc);
create index if not exists first_replies_campaign on public.first_replies (campaign_id);

create table if not exists public.service_interests (
  id text primary key,
  service text not null,
  rep_id text not null,
  at timestamptz not null default now()
);

alter table public.first_replies enable row level security;
revoke all on public.first_replies from anon, authenticated;
alter table public.service_interests enable row level security;
revoke all on public.service_interests from anon, authenticated;
