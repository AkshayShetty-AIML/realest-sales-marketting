# Sales app — build status

The builder's sales-automation desk. It runs on **:3001** beside the premium
app on :3000. Shared data (leads, properties, inventory and messages in both
directions) is read and written **live** through the premium app's
`/api/internal/*`. This app stores **sales state only**. Written for whoever
picks this up next.

Last updated: **2026-10-02** (Batch 3: lead scoring, personalised
brochures, verified live inventory, sales dashboard)

---

## Status at a glance

| Feature | Status | Notes |
|---|---|---|
| Premium integration (all 9 endpoints) | **Working, live-verified** | `PREMIUM_API_BASE` + `x-service-key`; every response zod-checked (`lib/premium/contract.ts`) |
| New-lead feed | **Working, live-verified** | Premium Realtime `leads` broadcast (anon key, contentless signal). Falls back to polling `/leads?since=` every 5 s; both paths tested |
| Instant grounded reply | **Working, live-verified** | Reply in about 3 s after a real premium inquiry. Logged to the premium thread. Idempotent, including against the premium thread itself |
| Inbox, lead page, pipeline | **Working, live-verified** | Data table, a two-pane lead page, a stage chart plus board. Live refresh every 10–15 s |
| Routing / assignment | **Working, live-verified** | Locality, then load. Writes `assignedTo` to premium |
| WhatsApp outbound (Twilio) | **Paused** (`WHATSAPP_PAUSED=true`); built, not yet verified | Real REST sends; opt-in; 24-hour window plus approved template; delivery status in the thread. **No Twilio credentials in `.env.local` yet** |
| WhatsApp inbound (webhook) | **Built, NOT verified live** | `/api/twilio/inbound`: signature-checked, attaches to the premium lead thread, saves an AI draft for the rep. Needs credentials and a tunnel |
| Rep sign-in (Clerk) | **Built, not configured** | Roster-only. Without Clerk the desk serves **localhost only** |
| Own Supabase (sales state) | **Built, not configured** | `supabase/migrations/0001…0002`; the local file store is in use |
| SMS / email | **Queued, "pending Twilio (production)"** | Never sent; TRAI DLT is required before any SMS (production TODO) |
| **Site-visit self-booking** | **Working, live-verified** | `/b/<token>`: calendar, slot picker, auto-confirm (POST /visits + PATCH confirmed), confirmation in-app |
| **Follow-up sequences** | **Working, live-verified** | Builder at `/sequences`; 9 defaults; the engine runs steps; in-app is delivered, WhatsApp/email/SMS are queued |
| **No-show reduction** | **Working, live-verified** | −24 h / −2 h reminders, "I'll be there", one-tap reschedule, auto no-show at +3 h, recovery sequence |
| **Geotag check-in** | **Working, live-verified** | Buyer (link) or rep (desk); ≤300 m counts as on site and completes the visit; proof stored |
| **Post-visit feedback** | **Working, live-verified** | Form link in-app after completion; interested → negotiation + follow-up; objection → targeted nudge |
| **Lead scoring** | **Working, live-verified** | Deterministic hot/warm/cold with reasons. The inbox is sorted by priority and has a Hot view. Model seam: `lib/scoring/model.ts` |
| **Personalised brochure** | **Working, live-verified** | An on-brand A4 PDF: fit to the buyer's stated needs, the honest grade, caveats. Sent in-app as a private link; WhatsApp/email queued |
| **Verified live inventory** | **Working, live-verified** | `/inventory`: live status, "last verified" stamp with freshness, rep verification. Premium's 409 guard is surfaced, never bypassed |
| **Sales dashboard** | **Working, live-verified** | `/dashboard`: funnel, pipeline, scores, response times, visits and no-show rate, live inventory |

---

## Part 1: real premium data

- **No local copies of premium data.**
  - `lib/inbox-data.ts` and the lead page read `GET /leads` and
    `GET /leads/:id` on every render.
  - The old local store of inbound messages is gone: inbound WhatsApp is
    attached to the **premium** thread (`POST /leads/:id/messages` with
    `direction: "inbound"`, a small premium API change).
  - The sales store keeps sales state only: reps, assignments, consent,
    instant-reply records, conversation mode and AI suggestions, WhatsApp
    sessions and delivery status, a phone **hash** index, sequences, the
    audit log and the sync cursor. `.data/sales-store.json` was reset (the
    old copy is backed up in `.data/`); the seed now adds only reps and the
    planned sequence.
- **Feed** (`lib/automation/realtime.ts`):
  - Subscribes to the premium **`leads` broadcast** (premium migration
    `20261002000500`, applied) using `PREMIUM_SUPABASE_URL` and
    `PREMIUM_SUPABASE_ANON_KEY`. The event carries **no lead data**.
  - Each signal runs one sync, `GET /leads?since=<cursor>`, which is masked;
    new unanswered leads get the instant reply.
  - Whenever Realtime isn't subscribed, it polls every 5 s.
  - The premium **secret** key is no longer in this app.
- **Dedupe:**
  - The store's per-lead claim is the lock.
  - An AI reply already on the premium thread counts as replied, so a store
    reset can't cause a double reply.
- **Port and env:**
  - `npm run dev` now runs on :3001.
  - Env names changed: `PREMIUM_API_BASE=http://localhost:3000/api/internal`
    (the old `PREMIUM_API_BASE_URL` still works); `PREMIUM_SUPABASE_ANON_KEY`
    replaces the secret key.
- **Creating a real inquiry:** use the premium form, or the premium repo's
  `npm run dev:inquiry -- --property cedar-heights --phone "+91…"`. That
  writes the same row the form does, plus optional contact details, because
  the form doesn't ask for a phone number yet.

## Part 2: real Twilio WhatsApp

- **Outbound** (`lib/whatsapp/twilio.ts`): REST API, with credentials only on
  the server. Every send:
  1. Requires recorded **opt-in**.
  2. Picks the destination: sandbox with `WHATSAPP_DEMO_TO` → always that
     number (your phone); otherwise the lead's phone, fetched unmasked at send
     time and never stored.
  3. Applies the **24-hour rule**, tracked per number hash from inbound
     messages:
     - inside the window, the free-form text is sent;
     - outside it, the approved template (`TWILIO_CONTENT_SID`) is sent, and
       its text is fetched from the Content API so the log shows what the
       buyer actually received;
     - with no template configured, the send is refused with a clear reason.
  4. Is recorded in `wa_messages` with Twilio's SID and status, and logged to
     the premium thread as `channel: whatsapp` only after Twilio accepts it.
  5. Errors are translated into plain language (63016 window, 63015 sandbox
     not joined, 20003 credentials…) and shown on the message in the thread.
     Failed sends that never reached premium still appear, marked failed.
- **Status webhook:** `/api/twilio/status` is signature-checked and moves the
  status forward (queued → sent → delivered → read, or failed/undelivered
  with the reason). It never moves a status backwards.
- **Inbound webhook:** `/api/twilio/inbound`.
  - It is signature-checked against `TWILIO_WEBHOOK_BASE_URL` + the path, and
    anything unsigned or forged gets 403.
  - Every inbound message opens the 24-hour window for that number.
  - The message is routed by phone hash and attached to the premium lead
    thread as inbound.
  - `STOP` opts the buyer out; any other message implies opt-in.
  - In AI mode, a question the property data fully covers is answered
    automatically. Otherwise a grounded **draft is saved for the rep** and
    shown as "Suggested reply" in the composer.
- **Instant reply on WhatsApp:** a new web lead hasn't messaged on WhatsApp,
  so the window is closed. The grounded answer goes **in-app** and, if the
  buyer opted in and a template is set, the approved template invites them to
  continue on WhatsApp.
- **Tunnel safety:** without Clerk, `proxy.ts` serves the desk to
  **localhost only**. Through ngrok, only `/api/twilio/*` is reachable.

## Part 3: UI

- **Tokens:** per the brief, forest `#0F6B46`, canvas `#FAF8F5`, mint/sage
  surfaces, and deep green / ochre / rust for trust. Playfair Display
  headings, Inter for the UI. Every text/background pair was computed at AA
  or better (white on forest 6.5:1, forest on canvas 6.2:1, muted on canvas
  5.8:1, caution 5.0:1, risk 5.1:1, rail text 10.0:1).
- **Layout:**
  - A dark-forest left nav with labels, live counts, a "need a rep" call-out,
    connection health and the signed-in rep.
  - Inbox: stat tiles, quick-view tabs (All / New / Needs a rep / Unassigned
    / Mine), stage and owner filters, and a **real data table** (sticky
    header, whole-row click target, readable stage/status/automation/consent
    chips).
  - Lead page, **two panes**: context on the left; on the right a
    viewport-height conversation with WhatsApp delivery status per message
    and a docked composer showing what a WhatsApp send will do right now.
  - Pipeline: a "Open leads by stage" chart above the board.
  - Connections: per-integration state and the exact Twilio webhook URLs.
- **Chart** (dataviz method): one series over ordered categories, so
  horizontal bars in one validated hue (`validate_palette.js`: all checks
  pass on white). Bars are 20px with a 4px rounded tip and a square base;
  values sit at the tip in ink; each bar has a hover/focus tooltip; there is
  no legend; a screen-reader table holds the same data.

## Batch 2: visits, sequences, no-show reduction, check-in, feedback

**Delivery today.** `in_app` is the live channel: the premium API puts the
message in the buyer's thread (`POST /leads/:id/messages`, `channel: in_app`).
Twilio is parked, so `whatsapp`, `sms` and `email` steps are recorded as
`pending_twilio` and shown as **"pending Twilio (production)"**: in the
conversation, on the lead's Automation card and on `/sequences`. Nothing is
sent. Delivery is decided in one place, `lib/automation/delivery.ts`.

**Buyer links** (`lib/links.ts`, `/b/<token>`):
- Each link is a random 128-bit token stored in the sales store, with one
  purpose (`book`, `visit` or `feedback`), one lead, and an expiry (14, 30 or
  21 days).
- The pages are public, the same way the Twilio webhooks are, and show the
  property and the buyer's own visit only: no contact details.
- Every buyer action re-checks the token. The no-sign-in desk identity also
  requires a localhost request inside `lib/auth.ts`, because server actions
  can be posted to any page path.

**1 · Site-visit scheduling** (`lib/scheduling/*`, `lib/automation/visits.ts`):
- Slots come from the visit hours on `/visits`: 10:00–18:00 IST, 60-minute
  slots, 2 visitors per slot, 14 days ahead, 3 hours' notice, optional closed
  days. Each property's booked visits are subtracted.
- A booking is re-checked on the server, created with `POST /visits` (premium
  moves the stage to `visit_scheduled`) and **auto-confirmed** with
  `PATCH /visits/:id → confirmed`. The confirmation, with the visit link, is
  sent in-app.
- Booking stops the nudge sequences and starts the pre-visit sequence,
  timed relative to the slot.
- Reps can send the booking link, or book for the buyer, from the lead page.

**2 · Sequences** (`lib/automation/sequences.ts`, `engine.ts`, `/sequences`):
- A sequence is a trigger plus steps, each with a delay, a channel and a
  template.
- Triggers: `inquiry_received`, `no_reply` (after N hours), `cold_lead`
  (after N days), `visit_booked`, `visit_no_show`, `feedback_interested`,
  `feedback_objection` (one per objection).
- Templates use real variables only (first name, property facts, visit
  time, freshly minted links, rep). `{{x|fallback}}` is supported, and the
  desk never invents a value.
- **The engine** runs every 30 s. Every 5 minutes it sweeps for no-reply and
  cold leads and checks for no-shows. Each due step is re-checked when it
  runs:
  - the lead is won or lost → the step is cancelled;
  - the buyer replied (for stop-on-reply sequences) → the sequence stops;
  - a rep has taken over → the sequence stops;
  - quiet hours (20:00–09:00 IST) → the step moves to 09:00;
  - more than 3 automated messages to the lead in 24 hours → deferred by 4
    hours.
- **9 defaults are seeded:** post-inquiry, no-reply, pre-visit, no-show
  recovery, cold-lead reactivation, after-visit interested, and the price,
  location and "anything else" objection nudges.

**3 · No-show reduction:**
- reminders at −24 h (with a one-tap reschedule link) and −2 h (with the
  check-in link), plus a WhatsApp copy that is queued;
- "I'll be there", cancel, and one-tap reschedule (the old visit is
  cancelled, a new one booked; reminders move with it);
- a visit with no on-site check-in 3 hours after its slot is marked
  `no_show` automatically, or by a rep, and the recovery sequence fires.

**4 · Geotag check-in:**
- The buyer checks in on the visit page (open from 2 h before the slot until
  4 h after), or the rep checks in from the lead page. The browser's location
  is used, and the timestamp is recorded.
- The desk measures the distance to the property's coordinates. Within
  300 m counts as on site; the device's accuracy is credited, capped at
  150 m.
- An on-site check-in completes the visit (`PATCH → completed`; premium sets
  `visit_done`). An off-site one is recorded and shown, but doesn't count.
- Proof (location, time, distance, who) appears on the lead page and on
  `/visits`.

**5 · Post-visit feedback:**
- When the visit completes, the feedback-form link is sent in-app. The form
  asks how interested they are, what held them back (multiple choice), a
  rating and a comment.
- **Interested** → stage `negotiation`, status `in_progress`, and the
  "interested" follow-up starts.
- **Objections** → the matching targeted nudge starts. The price nudge
  quotes the real listed price from the property facts.
- **Not for me** → status `on_hold`; a rep decides whether the lead is lost.

**Premium app does not auto-reply.** I tested this with the desk stopped: a
real inquiry sat for 20 s with **zero outbound messages** (status `new`,
unassigned). When the desk started, its catch-up sent the only reply. The
premium side's scripted demo replies were removed earlier today; its
remaining "demo leads" for verified pros are display-only and never message
anyone.

---

## Batch 3: scoring, brochures, live inventory, dashboard

Reuses the Batch 1 integration (`x-service-key` → premium `/api/internal`).
Single-tenant, contract enums only. In-app is the live channel; WhatsApp,
email and SMS are queued "pending Twilio (production)".

### 1. Lead scoring (`lib/scoring/`)

- **Model:** `model.ts`, pure and deterministic (`deterministic-v1`). Every
  lead starts at 20 points; signed contributions are added, and each one is a
  reason:
  - **Behaviour:** follow-up messages from the buyer (+6 each, max +18);
    replied to us (+10); visit booked (+20); visited (+15); on-site check-in
    (+5); no-show (−10 each); feedback interested / maybe / not (+20 / +5 /
    −25); WhatsApp opt-in / out (±5).
  - **Fit:** the buyer's *stated* BHK vs the home's configuration (+10
    match / −6 differs); stated budget vs the real sale price (+10 within,
    0 up to 15% over, −10 beyond). Nothing is inferred that the buyer didn't
    say.
  - **Engagement:** inquiry kind (visit +10, callback +8, price +6,
    availability +5, general +2).
  - **Recency:** last buyer activity under 24 h +15; under 3 days +8; this
    week +3; over 14 days −10.
- **Bands:** hot ≥ 60, warm ≥ 35, cold below. Won/lost leads are "closed".
  Priority order is band, then score, then recency.
- **Seam:** `ScoringModel { id, score(input) }`. Swap
  `deterministicModel` in `scoringModel()` for a trained model with the same
  input and output.
- **Inputs:** premium lead detail (thread, visits) and the property, plus
  this desk's visits, check-ins, feedback and consent (`load.ts`). Detail reads
  are memoised briefly (15 s detail / 60 s property, keyed on the list row),
  and GETs retry once on a premium 429. Together these keep a page refresh
  inside premium's rate limit (120 burst, 2/s).
- **UI:**
  - Inbox: a Score column showing the chip and top two reasons, a "Hot" view,
    and a sort control (priority / most recent).
  - Lead page: a score chip in the header and a "Lead score" card listing
    every signed reason.
- **Deferred:** junk and duplicate detection, until external lead sources
  exist.

### 2. Personalised brochure (`lib/brochure/`)

- **Content:** `content.ts`, pure. Everything comes from
  `GET /properties/:id`, the buyer's own words, or premium fields:
  - a **fit table** of what they said vs this home (Matches / Differs /
    Worth checking / You didn't say);
  - key facts from the grounded fact sheet;
  - highlights;
  - **availability with its last-verified stamp**;
  - **things to check**: construction %, RERA delay or not applicable,
    litigation, mismatches, stale inventory, invest-only;
  - **the honest grade**, unrounded, with its delivery, legal and reviews
    breakdown.
- **AI-written, grounded:** `generate.ts`. With `GROQ_API_KEY` set, the LLM
  rewrites only the opening paragraph, from the facts and the fit table. The
  draft must pass `guardReply` (every number in the facts, real fact keys, no
  links or contacts, no promises, ≤ 500 characters), or the composed paragraph
  is used. The engine and any fallback reason are recorded. Without a key
  (the current state) the paragraph is composed.
- **PDF:** `pdf.ts`, pdf-lib + fontkit. A4, Playfair Display and Inter from
  `assets/fonts`; forest masthead, grade tile in its grade colour, mint panels.
  Only the **content snapshot** is stored (`Brochure` record); the PDF is
  rendered on demand, so a download is exactly what was sent.
- **Download:**
  - Reps: `/api/brochures/<id>` (rep session).
  - Buyer: `/b/<token>` (summary page) and `/b/<token>/brochure.pdf`, using
    a brochure-purpose token (30 days).
- **Send:**
  - In-app → a private link in the premium thread.
  - WhatsApp / email → queued `pending_twilio`; nothing is sent.
  - Each delivery is shown on the lead's Brochure card.

### 3. Verified live inventory (`lib/inventory.ts`, `/inventory`)

- **Reads:** all units come live from `GET /inventory`, with each project's
  name. Freshness: fresh ≤ 7 days, ageing ≤ 30, stale > 30.
- **Verify:** `PATCH /inventory/:unitId {status, lastVerifiedAt}`. The
  timestamp defaults to now; a rep can enter an earlier IST time to record a
  past site check.
- **409 guard:** if premium holds a newer check, it answers **409**. The desk
  shows "Refused by premium (409): … Nothing changed" and **never retries with
  a newer timestamp**.
- **Lead page:** the Inventory card's status change uses the same path.
- **Dashboard:** status split plus freshness counts and the oldest check.

### 4. Sales dashboard (`/dashboard`, `lib/dashboard.ts`)

- **Panels, all computed live per request:**
  - Headline tiles.
  - **Conversion funnel**: leads that *reached* each step. "Reached" means the
    current stage or later evidence (a booked or completed visit).
  - **Pipeline** by contract stage (open leads).
  - **Lead scores** as a band split, plus the five highest-priority leads.
  - **Response times**: time to the first outbound message; median, p90, AI
    share and buckets.
  - **Site visits** from premium visits: upcoming, done, no-show, cancelled.
    No-show rate = no-shows ÷ (done + no-shows).
  - **Live inventory.**
- **Partial reads:** if a lead's detail can't be read (rate limit or
  network), it is left out and a banner says so, rather than counting it as
  "no reply".
- **Charts** follow the dataviz method:
  - `BarList` (one hue, ≤ 24px bars, 4px tip, values in ink, hover and focus
    tooltips, sr-only table) and `StackedBar` (fixed order, 2px gaps, a legend
    with counts and shares, tooltips, table).
  - Palettes were validated with `validate_palette.js` (`lib/chart-palette.ts`):
    - Score: forest ordinal ramp `#0f6b46 / #3f8c66 / #7fb596`, all checks
      pass.
    - Unit status: `#0f6b46 / #daa24c / #b7543a` in fixed order, adjacent pairs
      pass. Ochre is below 3:1 contrast, so every part carries a visible label
      and count. Forest and rust are never adjacent: protan ΔE is 2.0.

### Seed

`npm run db:seed` now also reads the **real premium leads** and:
- routes any unassigned open lead (PATCH `assignedTo`, as the desk normally
  does);
- starts the post-inquiry sequence for up to two fresh inquiry-stage leads
  that never had one.

It never fabricates consent or visits. `--no-leads` skips this step. Scores and
dashboard numbers come from the real threads and visits. On this run, all 14
open leads were already assigned and had runs, so it changed nothing.

## What you need to do to finish verifying WhatsApp

1. Twilio Console → Messaging → Try it out → **Send a WhatsApp message**.
   From your phone, send the join code to the sandbox number.
2. In `.env.local`, fill in:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` (the sandbox number)
   - `WHATSAPP_DEMO_TO=<your phone>`
3. Run `ngrok http 3001` and set `TWILIO_WEBHOOK_BASE_URL=https://<id>.ngrok-free.app`.
   In the sandbox settings, set "When a message comes in" to
   `<that URL>/api/twilio/inbound` (POST).
4. Optional: an approved template's Content SID in `TWILIO_CONTENT_SID`, for
   sends outside the 24-hour window.
5. Restart (`npm run dev`), message the sandbox once from your phone (this
   opens the window), then run `npm run verify:live`. Steps 4–5 now run for
   real: a real send from the Twilio number, a status callback, and a signed
   inbound reply attached to the premium thread.

## Before production

- **Clerk:** a Clerk app for reps; remove `SALES_ALLOW_UNAUTHENTICATED_DEMO`.
- **Own Supabase:** apply `0001`–`0005` (`0005` = brochures, plus the
  brochure link purpose); set `SALES_SUPABASE_*`.
- **Brochure AI:** set `GROQ_API_KEY` to have the intro AI-written (guarded).
  Today it is composed.
- **Scoring at scale:** the inbox and dashboard read every lead's detail.
  Past about 100 open leads, add a premium bulk-detail endpoint or score
  incrementally on the lead feed.
- **WhatsApp Business:**
  - an approved sender and templates; `TWILIO_MODE=live`;
  - collect phone **and** WhatsApp consent on the premium inquiry form, so the
    instant reply can open WhatsApp without a rep recording consent;
  - one inbound number shared by many leads routes to the lead last messaged
    (fine for the sandbox; for live, add a per-lead thread picker or include
    the lead in the template's reply button).
- **SMS:** TRAI DLT registration before any SMS.
- **Feed:** run it in one long-lived process; the poller is a safety net,
  not a scale-out design.
- **Inbox chip:** "No reply yet" in the inbox reads this desk's store. Leads
  answered before the store reset show "No reply yet" there, though the lead
  page and auto-reply see the premium thread's AI reply.

## Verified (Batch 3)

- **Sales app:**
  - `tsc` and ESLint clean; `next build` OK (19 routes, adding `/dashboard`,
    `/inventory`, `/api/brochures/[id]` and `/b/[token]/brochure.pdf`).
  - `verify:bundle` clean (27 client files).
  - `npm run verify` 72/72.
- **`npm run verify:batch3`**, against the real premium app and the running
  desk on :3001: **44/44**.
  - **Scoring:**
    - Pure cases: stale and vague → cold; replied, fitting and booked → hot;
      won → closed; no-show plus "not interested" ranks lower; reasons span
      all four families.
    - All live premium leads are scored (5 hot / 6 warm / 4 cold), and the
      inbox order is verified as priority order.
  - **Brochure:**
    - A real inquiry ("3 BHK around 1.2 cr, within 12 months") produced a fit
      table with Configuration and Budget **Matches** and Move-in **Worth
      checking**.
    - Grade C+ (62) appears unrounded, the under-construction caveat is
      present, and the PDF is real.
    - Sent in-app: the message is in the premium thread, its link resolves to
      this brochure, and the buyer page and PDF serve without sign-in.
    - A bad token gets 404, and the rep route serves the PDF.
    - WhatsApp and email are `pending_twilio`, and only the in-app message
      reached premium.
  - **Inventory:**
    - 11 units are live with stamps, and verifying one moved its stamp.
    - An older verification got **409**, and a re-read showed nothing
      changed.
  - **Dashboard:**
    - Funnel: 16 inquiries → 16 replied → 6 qualified → 6 visit booked → 4
      visited → 2 negotiation → 2 booking → 0 won.
    - Pipeline, bands, response buckets, visits and inventory all sum
      correctly, no lead was unreadable, and every panel renders.
- **Visual check:** headless-Chrome screenshots of the dashboard, inventory,
  inbox and lead page, plus the brochure PDF's first page.
- **Found and fixed during verification:**
  - Premium's rate limit made some detail reads fail, which were counted as
    "no reply". Fixed with the 429 retry and the read memo, and unreadable
    leads are now excluded and flagged.
  - pdf-lib's subsetter dropped Inter glyphs. Inter is now embedded whole
    (350 KB PDF).
  - "within 12 months" wasn't recognised as a timeline. The regex is
    widened.
- **Test data:** two more `inq-…` "Batch Three" leads, each with a brochure
  message in its premium thread. One premium unit's `lastVerifiedAt` is now
  the test time, with its status unchanged.
- **Premium app:** unchanged in this batch.

## Verified (Batch 2)

- **Sales app:**
  - `tsc` and ESLint clean; `next build` OK (15 routes, including `/b/[token]`,
    `/sequences` and `/visits`).
  - `verify:bundle` clean.
  - `npm run verify`: **72/72**. New checks cover IST and quiet hours, slots
    (notice, capacity, closed days, the reschedule exception, off-grid
    times), geo distance and the on-site rule, and template variables.
- **`npm run verify:batch2`**, against the real premium app and the running
  desk: **31/31**.
  - A real inquiry → the instant reply → the post-inquiry sequence (with a
    WhatsApp step queued).
  - The booking link arrives in-app in the premium thread; the page opens
    without contact details.
  - Booking → auto-confirmed → `visit_scheduled`; the in-app confirmation
    carries a visit link; the nudges stop.
  - One-tap reschedule: the old visit is cancelled, the new one confirmed,
    and the reminders move.
  - −24 h and −2 h reminders arrive in-app. The WhatsApp copy is
    `pending_twilio`, and no WhatsApp message reaches premium.
  - Check-in 6 km away is refused; at 56 m it completes the visit
    (`visit_done`) with proof stored.
  - The feedback link arrives in-app. Feedback of "maybe + price" fires the
    price nudge, which quotes the real listed price.
  - A second lead's visit is auto-marked no-show after +4 h, and the
    recovery message with a fresh booking link fires.
  - Time-based steps ran with a moved clock, for the test's own leads only.
- **Premium silence:** confirmed (see above).
- **Premium app:** links in in-app messages are now clickable. `tsc`,
  ESLint, build and `verify:bundle` are clean.
- **Test data:** test leads (`inq-…`) and their visits remain in the
  premium database. The moved-clock run marked some future-dated test visits
  as no-show.

## Verified (earlier round)

- **Sales app:**
  - `tsc` and ESLint clean. `npm run verify` 47/47 (adds the WhatsApp-window,
    status and error rules). `next build` OK.
  - `verify:bundle` clean: no secret value, name or key pattern in the 22
    client files.
  - `npm run verify:live` against the **real** premium app: 11 passed, 2 not
    run (Twilio).
    - A real premium inquiry was picked up by the **Realtime `leads`
      signal**, given the grounded reply in **3.0 s**, logged on the premium
      thread, and routed.
    - It shows in the inbox, masked.
    - The unsigned webhook is refused, and a tunnelled request can't open the
      desk (403).
  - Polling fallback: with the anon key blanked, a real inquiry was answered
    via `trigger: poll`.
  - The UI was reviewed via headless-Chrome screenshots at 1512px.
- **Premium app:**
  - Migration `20261002000500_leads_broadcast.sql` applied (dry-run first:
    it was the only pending one).
  - `verify:internal-api` 78/78, with 3 new inbound checks.
  - `verify` 29 guards, 0 failures; `verify:internal-live` passed;
    `verify:bundle` clean; build OK.
- **Not verified:** any real Twilio traffic, because there are no credentials
  yet (the live script reports these steps as NOT RUN). Also not verified:
  creating an inquiry through the premium **UI** form, which needs Clerk
  third-party auth configured on Supabase; it was done with
  `npm run dev:inquiry`, which writes the same row.

---

## Changelog

### 2026-10-02: UI restyle to the asset sheet (presentation only)

- **Tokens:** all tokens now live in one file, `app/styles/tokens.css`, lifted from `docs/ui-mockups/asset-sheet.png`. `globals.css` keeps the recipes only.
- **Shared components:**
  - Score badge and score circle, stage chips, stat tile (`components/Chips.tsx`, `components/ui/Card.tsx`).
  - Journey timeline (`components/lead/Lifecycle.tsx`) and the messaging-preferences checklist (`MessagingPrefs` in `controls.tsx`).
  - Message preview (`components/MessagePreview.tsx`, `lib/sequence-preview.ts`) and the sequence switch (`components/SequenceToggle.tsx`).
- **Shell:** the rail has seven work areas, with **Settings** (`/status`) at the bottom. Connections left the main nav.
- **Screens:**
  - **Dashboard:** fits one screen. It also lists upcoming visits and recent activity, read-only from existing data.
  - **Leads:** the mockup's table, plus search.
  - **Lead detail:** two panes. The left pane runs (a)–(g); the conversation is on the right with a compact composer. The WhatsApp card is replaced by the opt-in checklist.
  - **Pipeline:** kanban.
  - **Sequences:** rows show rendered previews; the editor previews each step.
  - **Inventory:** one-tap Verify.
  - **Visits:** tabs.
  - **Reps:** cards.
  - **Settings:** visit hours plus connections.
- **Not built:** add lead, add rep, KPI deltas, date/project filters, drag-and-drop, and SMS/email consent. Each needs new logic or data.
- **Checks:** 15/15 UI acceptance checks pass at 1440×900 (headless Chrome, production build). `tsc`, lint, build, `verify` 72/72 and `verify:bundle` are all clean.
- `StageChart.tsx` was removed (unused).

### 2026-10-02: Batch 3: lead scoring, brochures, live inventory, dashboard

- **New:**
  - `lib/scoring/{model,load}.ts`
  - `lib/brochure/{content,pdf,generate}.ts`
  - `lib/inventory.ts`, `lib/dashboard.ts`, `lib/chart-palette.ts`
  - `components/charts/{BarList,StackedBar}.tsx`
  - `components/lead/brochure.tsx`, `components/inventory/VerifyUnit.tsx`
  - `app/{dashboard,inventory}/page.tsx`
  - `app/api/brochures/[id]/route.ts`, `app/b/[token]/brochure.pdf/route.ts`
  - `supabase/migrations/0005_brochures.sql`
  - `scripts/verify-batch3.ts`, `scripts/render-brochure.ts`
  - `assets/fonts/*` (copied from premium)
  - Dependencies: `pdf-lib`, `@pdf-lib/fontkit`
- **Changed:**
  - Inbox: a Score column, a Hot view and a sort control.
  - Lead page: a score chip and card, and a Brochure card.
  - Nav: Dashboard and Inventory.
  - Store: a `Brochure` record, and the `brochure` link purpose and
    `brochureId`.
  - Actions: `verifyUnitAction`, `generateBrochureAction`,
    `sendBrochureAction`. `unitStatusAction` now goes through `verifyUnit`
    (409 surfaced).
  - Premium client: one retry on a 429 for GETs.
  - Contract: optional `gradeScore` and `gradeBreakdown` on properties.
  - Timeline parsing: "within N months/years".
  - The seed reads real premium leads.
  - The ESLint guard covers the new server modules.

### 2026-10-02: Batch 2: visits, sequences, no-show reduction, geotag check-in, feedback

- **New modules:**
  - `lib/scheduling/{time,slots,geo}.ts` (pure)
  - `lib/links.ts`
  - `lib/automation/{delivery,vars,templates,sequences,visits,engine}.ts`
- **New pages:** `/b/<token>` (buyer: book, visit, feedback), `/sequences`
  (builder) and `/visits` (agenda + visit hours). The lead page gains an
  Automation card, a richer Visits card (booking link, rep geotag check-in,
  proof, feedback), and queued "pending Twilio" messages in the
  conversation.
- **Delivery:** `in_app` is delivered. `whatsapp`, `sms` and `email` (from
  sequences or reps) are queued as `pending_twilio`, never sent. Previously
  SMS and email were logged to premium as if sent.
- **Scheduling:** the engine starts in `instrumentation.ts` (30 s tick). The
  seed adds 9 default sequences and the visit hours.
- **Store:** migration `0004_visits_sequences.sql` (`sequence_runs`, `jobs`,
  `visit_records`, `check_ins`, `feedback`, `link_tokens`; RLS on, server
  only).
- **Security:** `/b/*` is public and token-checked. The demo identity now
  also requires a localhost request inside `lib/auth.ts`.
- **Premium:** links in thread messages are clickable (rendered as elements,
  never as injected HTML).
- **Fixed while verifying:** no-show recovery was timed from "now" rather
  than from when the no-show was detected.
- **Tests:** `verify:batch2` (31). Unit checks rose from 47 to 72.


### 2026-10-02: WhatsApp paused; inbound read from Twilio's log

- **`WHATSAPP_PAUSED=true`** (now set in `.env.local`): the Twilio
  credentials are kept, but nothing calls Twilio (no sends, no log polling).
  WhatsApp shows as "paused" on Connections and in the composer. Instant
  replies and rep messages go in-app. Remove the line and restart to resume.
- **Trial senders can't call a webhook.** The trial "Try out WhatsApp" sender
  (+1 737 250 8034) is a shared number with no inbound-webhook setting.
  - Added `lib/whatsapp/inbound-poll.ts`, which reads inbound replies from
    Twilio's message log every 10 s. Each Message SID is claimed once
    (`claimInboundSid`, migration `0003_wa_inbound.sql`), so the poller and
    the webhook never double-process.
  - The 24-hour window now also checks Twilio's message log.
  - `TWILIO_WHATSAPP_FROM` is set to the trial sender. `WHATSAPP_DEMO_TO` is
    set to the phone that actually joined.
- **Resuming WhatsApp:** real sends and inbound end to end have not been
  verified. Next time: unpause, send from a lead, reply, and check the
  thread.

### 2026-10-02: Batch 2: real premium data, real Twilio WhatsApp, restyle

- **Live data:**
  - Premium data is read live only. Inbound messages move to the premium
    thread. The store is reset to sales state only, and the seed has no
    demo opt-ins or demo assignments.
  - The feed is the premium `leads` broadcast (anon key) with a 5 s polling
    fallback.
- **WhatsApp:**
  - Real sends with opt-in and the 24-hour rule (template outside the
    window), delivery status (`wa_messages`) and plain-language errors.
  - Signed `/api/twilio/inbound` and `/api/twilio/status` webhooks.
  - AI suggested drafts for reps.
  - The simulation mode and the demo simulator are removed.
- **Security:** a localhost-only guard for the no-sign-in mode; the premium
  secret key is removed from this app.
- **UI:**
  - New tokens; the dark-forest labelled nav; the inbox data table with
    views.
  - The two-pane lead page with a docked composer.
  - The pipeline chart; the Connections page.
- **Premium:**
  - `direction: "inbound"` on `POST /leads/:id/messages`.
  - The `leads` broadcast migration.
  - `npm run dev:inquiry`.
- **Scripts:** `verify:live` replaces `verify:e2e` and `verify:http`. Port
  3001. Migration `0002_whatsapp_state.sql`.
- **Fixed while verifying:**
  - The localhost guard first rejected real localhost requests, because Next
    sets `x-forwarded-host` itself. It now compares host names.
  - The live test read the reply's claim row before the reply finished.


### 2026-10-02: UI sweep (premium design system)

- **Root-cause fix:** the sales-desk button, chip and field classes had ended
  up inside the `prefers-reduced-motion` media query when the stylesheet was
  assembled. They only applied with reduced motion on, so buttons rendered as
  plain text and inputs had no borders. `app/globals.css` is now generated
  from the premium stylesheet with additions in the components layer.
- **Premium components:**
  - `components/ui/Button.tsx`: copied verbatim. Primary (forest fill),
    secondary (white, bordered) and ghost; one primary per block.
  - `components/icons.tsx`: copied, plus inbox, board, users, pulse, send,
    calendar, route and wand icons.
  - The premium icon `NavRail` and sticky header.
- **New primitives on the same tokens:**
  - `Badge`: read-only state, a dot and a pill, never clickable.
  - `TagChip`.
  - `Card`: a white surface with a Playfair header and an action slot.
  - `KeyValues` and `Stat`.
  - `Field`, `Select`, `Input`, `TextArea`: white wells, a visible border,
    a label above.
  - `Segmented`: the Buy / Rent / Invest switch recipe, used for the message
    channel.
- **Screens:**
  - Inbox: stat tiles, a labelled filter bar, and rows that are a single
    "Open →" target.
  - Lead page: a header card with the one primary action; the conversation
    as chat bubbles plus a composer dock (mode banner, channel switch,
    labelled message box, primary Send); demo tools in a dashed box; context
    and facts cards. The side column has Owner & pipeline, Contact, WhatsApp
    consent, Visits, Inventory and an Activity timeline.
  - Pipeline: stage columns with counts and empty states.
  - Reps: cards.
  - Status: a badge per integration.
- **Figures:** `.font-tabular` now uses lining figures, so a Playfair "0"
  never reads as an "o". The Next dev indicator moved off the rail.
- **Verified:** tsc and ESLint clean, `verify` 42/42, build OK,
  `verify:bundle` clean. Headless-Chrome screenshots of every screen were
  reviewed.

### 2026-10-02: Sales app, batch 1

- **New repo** `sales-automation-app` (Next.js 16 App Router, TypeScript,
  Tailwind 4, Clerk). The premium design tokens were copied verbatim:
  Playfair + Inter, warm canvas, forest, and the grade/trust colours.
- **Integration:**
  - `lib/premium/client.ts` covers all 9 internal endpoints;
    `lib/premium/contract.ts` holds the exact contract enums and zod response
    schemas.
  - `lib/automation/realtime.ts` holds the server-side Realtime
    subscription. It is "live" only after the database confirms the
    subscription, and it catches up via `GET /leads?since=`.
- **Inbox and pipeline:**
  - `/inbox` (filters by status, stage and assignee);
  - `/pipeline` (stage columns);
  - `/leads/[id]` (context, conversation, composer, opt-in, visits,
    inventory, activity);
  - `/reps`; `/status`.
- **Automation:**
  - instant grounded auto-reply (idempotent);
  - routing and assignment;
  - takeover / hand-back;
  - inbound handling (STOP, implied opt-in, answer-or-wait).
- **Grounding:** fact sheet, composer, guard, LLM drafter with fallback.
- **WhatsApp:** Twilio REST sender (simulated / sandbox / live), signed
  webhook, phone hashing.
- **Store:** file and own-Supabase backends behind one interface; migration
  `0001_sales_schema.sql`.
- **Seed:** `npm run db:seed` adds 3 reps (territories matching the premium
  demo localities), simulated opt-ins for demo-lead-1 and demo-lead-3,
  demo-lead-3 → rep-kavya (written to premium too), and a planned sequence.
- **Auth:** roster-only rep access via Clerk; an explicit local demo flag;
  `/setup` and `/not-a-rep` pages.
- **Verification:** `verify` (42), `verify:e2e` (27, live), `verify:http`
  (15, including the live Realtime probe), `verify:bundle`.
- **Fixed while verifying:**
  - The `/not-a-rep` build crash: Clerk's button was rendered without its
    provider.
  - A Realtime gap: `SUBSCRIBED` arrives before the database subscription is
    live, so a lead inserted in that window was never replied to. The
    subscription now waits for the database confirmation before going live
    and running the catch-up.
