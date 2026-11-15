-- Processed inbound Twilio Message SIDs — so the webhook and the message-log
-- poller (lib/whatsapp/inbound-poll.ts) never handle the same reply twice.
-- RLS on, no policies (server-only). Idempotent.
create table if not exists public.wa_inbound (
  sid text primary key,
  at timestamptz not null default now()
);
alter table public.wa_inbound enable row level security;
revoke all on public.wa_inbound from anon, authenticated;
