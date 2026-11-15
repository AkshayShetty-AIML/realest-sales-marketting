/**
 * LIVE end-to-end check against the REAL premium app and the RUNNING sales
 * desk (no demo data, nothing simulated):
 *
 *   npm run verify:live                       (sales desk at http://localhost:3001)
 *   SALES_BASE=http://localhost:3001 npm run verify:live
 *
 *  1. creates a REAL inquiry in the premium DB (premium repo's `npm run dev:inquiry`)
 *  2. the desk picks it up through the premium Realtime "leads" signal (polling is the fallback)
 *  3. it shows in the inbox (masked) and gets the grounded instant reply, logged on the premium thread
 *  4. [Twilio configured] a REAL WhatsApp send → logged to the premium thread with a Twilio SID + status
 *  5. [Twilio + TWILIO_WEBHOOK_BASE_URL] a correctly SIGNED inbound webhook → the reply lands on the lead
 *  6. guards: unsigned webhook refused; a tunnel host can't reach the desk
 *
 * Writes real rows (a test inquiry, its messages). Steps that need Twilio
 * credentials print NOT RUN with the reason instead of pretending.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { premium } from "../lib/premium/client";
import { store } from "../lib/store";
import { contactPepper, twilioConfig } from "../lib/env";
import { sendMessage } from "../lib/automation/leads";
import { twilioSignature } from "../lib/whatsapp/signature";
import { phoneHash, toE164 } from "../lib/whatsapp/phone";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PREMIUM_REPO = join(process.cwd(), "..", "consumer-property-app");

let failures = 0;
let passes = 0;
const skipped: string[] = [];
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}
const notRun = (label: string, why: string) => {
  skipped.push(label);
  console.log(`  – NOT RUN: ${label} (${why})`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const page = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  return { status: res.status, text: await res.text() };
};

async function main(): Promise<void> {
  const twilio = twilioConfig();
  const demoTo = twilio?.demoTo ? toE164(twilio.demoTo) : null;

  console.log(`Sales desk ${BASE} · premium ${process.env.PREMIUM_API_BASE}\n`);
  console.log("1 · A real premium inquiry");
  check("sales desk is up", (await page("/status")).status === 200);
  const args = ["run", "-s", "dev:inquiry", "--", "--property", "cedar-heights", "--kind", "availability", "--message", "Is a 2 BHK still available? (sales-desk live test)", "--name", "Live Test"];
  if (demoTo) args.push("--phone", demoTo);
  const leadId = execFileSync("npm", args, { cwd: PREMIUM_REPO, encoding: "utf8" }).trim().split("\n").at(-1) ?? "";
  check("inquiry created in the premium DB", /^inq-/.test(leadId), leadId);
  console.log(`    lead ${leadId}`);

  console.log("\n2 · Picked up by the new-lead feed");
  // The store's claim row appears the moment a reply STARTS (outcome "failed"
  // as a placeholder); the "auto-reply" audit entry is written when it FINISHES.
  let done = null;
  const started = Date.now();
  for (let i = 0; i < 60 && !done; i += 1) {
    await sleep(500);
    done = (await store().listAudit(leadId, 20)).find((e) => e.kind === "auto-reply" || e.kind === "auto-reply-failed") ?? null;
  }
  const reply = await store().getAutoReply(leadId);
  check(`instant reply finished in ${((Date.now() - started) / 1000).toFixed(1)} s, no manual action`, done?.kind === "auto-reply" && !!reply && reply.outcome !== "failed", done?.detail ?? reply);
  const trigger = done?.detail.match(/trigger: ([\w-]+)/)?.[1];
  check("triggered by the premium Realtime \"leads\" signal", trigger === "realtime" || trigger === "realtime-connect", trigger ?? "no trigger");

  console.log("\n3 · In the inbox, masked, reply logged on the premium thread");
  const inbox = await page("/inbox");
  check("inbox lists the new lead", inbox.status === 200 && inbox.text.includes(encodeURIComponent(leadId)));
  check("contact masked in the inbox", !(demoTo && inbox.text.includes(demoTo.slice(-7))));
  const detail = await premium.getLead(leadId);
  check("grounded reply logged on the premium thread (sentBy ai-auto-reply)", detail.messages.some((m) => m.sentBy === "ai-auto-reply" && m.direction === "outbound"));
  check("lead routed to a rep", !!detail.assignedTo, detail.assignedTo);
  check("lead page renders", (await page(`/leads/${encodeURIComponent(leadId)}`)).status === 200);

  console.log("\n4 · Real outbound WhatsApp");
  let sentOk = false;
  if (!twilio) {
    notRun("WhatsApp send", "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM not set");
  } else {
    await store().setOptIn({ leadId, channel: "whatsapp", status: "opted_in", source: "rep-recorded:verify-live", recordedAt: new Date().toISOString(), simulated: false });
    try {
      const sent = await sendMessage(leadId, "whatsapp", "Hi! Yes — a 2 BHK is available. Would you like to visit this week? (sales-desk live test)", "verify-live");
      check(`Twilio accepted it (${sent.sid}${sent.template ? ", approved template — outside the 24-hour window" : ""})`, /^(SM|MM)/.test(sent.sid ?? ""));
      const thread = await premium.getLead(leadId);
      check("logged to the premium thread as channel whatsapp", thread.messages.some((m) => m.channel === "whatsapp" && m.sentBy === "verify-live"));
      const wa = (await store().listWaMessages(leadId)).at(-1);
      check("Twilio status recorded for the thread", !!wa?.sid && !!wa.status, wa?.status);
      sentOk = true;
      if (twilio.webhookBase) {
        for (let i = 0; i < 20; i += 1) {
          await sleep(1000);
          const s = (await store().listWaMessages(leadId)).at(-1)?.status;
          if (s && s !== "queued") break;
        }
        const s = (await store().listWaMessages(leadId)).at(-1);
        check(`status callback updated it (${s?.status}${s?.errorMessage ? ` — ${s.errorMessage}` : ""})`, !!s && s.status !== "queued");
      } else notRun("status callback", "TWILIO_WEBHOOK_BASE_URL not set");
    } catch (error) {
      check("WhatsApp send", false, error instanceof Error ? error.message : error);
    }
  }

  console.log("\n5 · Inbound WhatsApp via the signed webhook");
  if (!twilio?.webhookBase) {
    notRun("inbound webhook", "Twilio credentials and TWILIO_WEBHOOK_BASE_URL needed");
  } else if (!sentOk) {
    notRun("inbound webhook", "routing needs a successful send to the number first");
  } else {
    const dest = demoTo ?? toE164((await premium.getLead(leadId, { includeContact: true })).contact.phone ?? "");
    if (!dest) notRun("inbound webhook", "no destination number");
    else {
      const params = { From: `whatsapp:${dest}`, To: twilio.from, Body: "Is it ready to move in? (live test)", MessageSid: `SMtest${Date.now()}` };
      const signature = twilioSignature(twilio.authToken, `${twilio.webhookBase}/api/twilio/inbound`, params);
      const res = await fetch(`${BASE}/api/twilio/inbound`, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": signature } });
      check("signed inbound accepted (200 TwiML)", res.status === 200, res.status);
      const thread = await premium.getLead(leadId);
      check("reply attached to the premium lead thread (inbound, whatsapp)", thread.messages.some((m) => m.direction === "inbound" && m.channel === "whatsapp" && m.body.includes("ready to move in")));
      check("24-hour window now open for that number", !!(await store().getWaSession(phoneHash(dest, contactPepper()))));
    }
  }

  console.log("\n6 · Guards");
  const unsigned = await fetch(`${BASE}/api/twilio/inbound`, { method: "POST", body: new URLSearchParams({ From: "whatsapp:+910000000000", Body: "x" }) });
  check(`unsigned webhook refused (${unsigned.status})`, twilio?.webhookBase ? unsigned.status === 403 : unsigned.status === 404);
  const tunnel = await page("/inbox", { "x-forwarded-host": "abc.ngrok-free.app" });
  check("a tunnelled request can't open the desk (403)", tunnel.status === 403 && !tunnel.text.includes("Cedar"), tunnel.status);

  console.log(`\n${failures === 0 ? "Live checks passed" : `${failures} failed`} (${passes} passed${skipped.length ? `, ${skipped.length} not run: ${skipped.join("; ")}` : ""}).`);
  console.log(`Test lead left in the premium DB: ${leadId}`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
