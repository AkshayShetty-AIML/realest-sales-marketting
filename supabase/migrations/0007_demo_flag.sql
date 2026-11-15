-- ═══════════════════════════════════════════════════════════════════════════
-- Demo mode on demand (npm run demo:seed / demo:clear). Demo records carry
-- demo = true; demo:clear removes only those. Harness workspaces and memory
-- items keep the flag inside their `data` jsonb, so only reps need a column.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reps add column if not exists demo boolean not null default false;
