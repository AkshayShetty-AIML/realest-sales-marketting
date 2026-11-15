-- ═══════════════════════════════════════════════════════════════════════════
-- Batch 3: personalised brochures (content snapshot; the PDF is rendered from
-- it on demand) and brochure buyer links. Sales state only. RLS on, no
-- policies, grants revoked — server (secret key) only. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.brochures (
  id text primary key,
  lead_id text not null,
  property_id text not null,
  content jsonb not null,
  engine text not null check (engine in ('llm','template')),
  fallback_reason text,
  created_at timestamptz not null default now(),
  created_by text not null,
  deliveries jsonb not null default '[]'::jsonb
);
create index if not exists brochures_lead on public.brochures (lead_id, created_at desc);

alter table public.link_tokens add column if not exists brochure_id text;
alter table public.link_tokens drop constraint if exists link_tokens_purpose_check;
alter table public.link_tokens add constraint link_tokens_purpose_check check (purpose in ('book','visit','feedback','brochure'));

alter table public.brochures enable row level security;
revoke all on public.brochures from anon, authenticated;
