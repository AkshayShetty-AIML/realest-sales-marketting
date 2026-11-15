/**
 * Runs once per server process. Starts the new-lead feed (premium Realtime
 * broadcast + polling fallback → instant grounded reply) in Node only, never
 * during `next build`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startLeadFeed } = await import("./lib/automation/realtime");
  startLeadFeed();
  // The scheduler: sequences, reminders, no-show detection, no-reply / cold-lead sweeps.
  const { startEngine } = await import("./lib/automation/engine");
  startEngine();
  // Replies on senders that can't call a webhook (Twilio trial) — read from the message log.
  const { startInboundPoller } = await import("./lib/whatsapp/inbound-poll");
  startInboundPoller();
  // Marketing: publishes approved, scheduled social posts when their time comes (stub — no social API).
  const { startMarketingPublisher } = await import("./lib/marketing/distribution");
  startMarketingPublisher();
  // Marketing harness: cron schedules → goal intake (outbound steps still wait for approval).
  const { harness, startAutomation } = await import("./lib/marketing/harness");
  startAutomation(harness().store);
}
