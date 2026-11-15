-- ═══════════════════════════════════════════════════════════════════════════
-- Real WhatsApp state. Idempotent. RLS on, no policies (server-only), like 0001.
--   wa_sessions   per destination-number HASH: last inbound → the 24-hour window
--   wa_messages   each outbound attempt + its Twilio delivery status
-- Inbound messages now live on the PREMIUM lead thread (POST /leads/:id/messages
-- with direction "inbound"), so inbound_messages is retired.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wa_sessions (
  phone_hash text primary key,
  last_inbound_at timestamptz not null
);

create table if not exists public.wa_messages (
  id text primary key,
  lead_id text not null,
  premium_message_id text,
  sid text unique,
  status text not null check (status in ('queued','sending','sent','delivered','read','failed','undelivered')),
  error_code text,
  error_message text,
  body text not null,
  template boolean not null default false,
  sent_by text not null,
  at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_messages_lead on public.wa_messages (lead_id, at);

alter table public.conversations add column if not exists suggested_draft jsonb;

drop table if exists public.inbound_messages;

do $$
declare t text;
begin
  foreach t in array array['wa_sessions','wa_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
