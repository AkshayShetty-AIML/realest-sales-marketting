# Sales desk — builder sales automation

Lead inbox, instant grounded replies and real WhatsApp (Twilio) for one
builder, on top of the premium app's internal API. Runs on **:3001** next to
the premium app on :3000.

```bash
npm install
cp .env.example .env.local     # PREMIUM_API_BASE + SALES_INTERNAL_API_KEY at minimum
npm run db:seed                # sequences + visit hours (+ you, via SEED_REP_EMAIL) — no demo data
npm run dev                    # http://localhost:3001
```

Nothing seeds on startup. For sample data, `npm run demo:seed` loads a small
demo set (2 reps, a demo harness workspace with the demo company in its
memory), every record tagged `demo: true` with a "Demo" badge in the UI; it
never writes leads to premium. `npm run demo:clear` removes only those records.
With the Supabase store, apply `supabase/migrations/0007_demo_flag.sql` first.

WhatsApp: fill the Twilio block in `.env.local`, run `ngrok http 3001`, set
`TWILIO_WEBHOOK_BASE_URL` to the https URL, and point the Twilio sender's
"When a message comes in" at `<that URL>/api/twilio/inbound`. The Connections
page shows the exact URLs.

Checks: `npm run typecheck` · `npm run lint` · `npm run verify` (pure) ·
`npm run build && npm run verify:bundle` · `npm run verify:live` (real premium + running desk).

Status, design and production TODOs: [docs/SALES_APP_STATUS.md](docs/SALES_APP_STATUS.md).
