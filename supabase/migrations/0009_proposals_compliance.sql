-- ═══════════════════════════════════════════════════════════════════════════
-- Batch S3 wave 2: per-project advertising compliance (a RERA registration
-- number OR an exemption statement with its reason and evidence reference)
-- and proposals (OPS-02: versioned cost sheet + payment plans per lead and
-- unit; prices are read from premium at generation time). RLS on, no
-- policies, grants revoked — server (secret key) only. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.project_compliance (
  project_id text primary key,
  mode text not null check (mode in ('rera','exempt')),
  rera_reg_no text,
  exemption jsonb,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check ((mode = 'rera' and rera_reg_no is not null) or (mode = 'exempt' and exemption is not null))
);

create table if not exists public.proposals (
  id text primary key,
  lead_id text not null,
  property_id text not null,
  unit_id text not null,
  version integer not null check (version > 0),
  content_hash text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  send jsonb not null,
  unique (lead_id, unit_id, version)
);
create index if not exists proposals_lead on public.proposals (lead_id, version desc);

alter table public.project_compliance enable row level security;
revoke all on public.project_compliance from anon, authenticated;
alter table public.proposals enable row level security;
revoke all on public.proposals from anon, authenticated;

-- Proposal share links (/b/<token> → the proposal PDF).
alter table public.link_tokens add column if not exists proposal_id text;
alter table public.link_tokens drop constraint if exists link_tokens_purpose_check;
alter table public.link_tokens add constraint link_tokens_purpose_check check (purpose in ('book','visit','feedback','brochure','proposal'));
