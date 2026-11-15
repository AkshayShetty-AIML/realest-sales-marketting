import "server-only";
import { randomUUID } from "node:crypto";
import { nextRun, validCron } from "./cron";
import type { HarnessStore, ScopedStore } from "./store";
import { audit, untrusted, type Untrusted } from "./trust";
import type { Notification, Schedule } from "./types";

/**
 * 5 · AUTOMATION ENGINE — scheduled jobs (cron, in the workspace's timezone),
 * event triggers, and notifications. Create / edit / pause / resume /
 * run-now / delete.
 *
 * A firing does exactly one thing: it SUBMITS A GOAL through the injected
 * goal runner (index.ts wires orchestrator.submitGoal + runGoal). So every
 * autonomous run takes the same path as an operator's goal — planner →
 * sub-agents → tools → THE SAME APPROVAL GATE. Nothing here can call a tool,
 * and outbound actions from a schedule wait for a human like any other.
 *
 *  - suggest-only workspaces: schedules PLAN only (tasks wait for the operator).
 *  - harness off: firings are skipped, and the operator is told.
 *  - event payloads are third-party data: attached to the goal as UNTRUSTED.
 *  - a goal started by an event never emits goal.* events (no trigger chains),
 *    and one schedule fires at most once a minute.
 *
 * SEAMS: registerNotifier() (email / WhatsApp / Slack later — the default
 * stores notifications for the console); onEvent() for features to listen;
 * emit() for features to raise events ("lead.created", "inventory.changed").
 */

// ─── notifications ──────────────────────────────────────────────────────────

export interface Notifier {
  name: string;
  send(scoped: ScopedStore, notification: Notification): Promise<void>;
}

const g = globalThis as unknown as {
  __harnessNotifiers?: Map<string, Notifier>;
  __harnessListeners?: Map<string, EventHandler[]>;
  __harnessRunners?: WeakMap<HarnessStore, GoalRunner>;
  __harnessAutomation?: { timer: ReturnType<typeof setInterval> | null; running: boolean; lastTickAt: string | null; lastError: string | null };
};
const notifiers = () => (g.__harnessNotifiers ??= new Map([["console", { name: "console", send: (scoped: ScopedStore, n: Notification) => scoped.put("notifications", n) }]]));

export function registerNotifier(notifier: Notifier): void {
  notifiers().set(notifier.name, notifier);
}

export async function notify(scoped: ScopedStore, input: Pick<Notification, "kind" | "title" | "body" | "ref">): Promise<void> {
  const notification: Notification = { id: randomUUID(), workspaceId: scoped.workspaceId, at: new Date().toISOString(), read: false, ...input };
  for (const n of notifiers().values()) {
    try {
      await n.send(scoped, notification);
    } catch (error) {
      console.warn(`[harness] notifier ${n.name} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

// ─── the goal runner (injected) ─────────────────────────────────────────────

export type GoalRunner = (workspaceId: string, goal: { text: string; actor: string; source: string; plannedOnly: boolean; attachments: Untrusted[] }) => Promise<{ goalId: string } | { skipped: string }>;

/** Binds a goal runner to a store: firings against that store's workspaces go through it. */
export function setGoalRunner(store: HarnessStore, runner: GoalRunner): void {
  (g.__harnessRunners ??= new WeakMap()).set(store, runner);
}

// ─── schedules ──────────────────────────────────────────────────────────────

export class ScheduleError extends Error {
  override name = "ScheduleError";
}

export interface ScheduleInput {
  name: string;
  trigger: Schedule["trigger"];
  goal: string;
}

function check(input: ScheduleInput): void {
  if (!input.name.trim()) throw new ScheduleError("Give the schedule a name.");
  if (!input.goal.trim()) throw new ScheduleError("Say what the schedule should do (its goal).");
  if (input.trigger.kind === "cron") {
    const problem = validCron(input.trigger.cron);
    if (problem) throw new ScheduleError(`Schedule time: ${problem}`);
  } else if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(input.trigger.event)) throw new ScheduleError("Event names look like lead.created");
}

const nextFor = (s: Pick<Schedule, "trigger" | "status">, after: Date, timezone: string): string | null =>
  s.status === "active" && s.trigger.kind === "cron" ? (nextRun(s.trigger.cron, after, timezone)?.toISOString() ?? null) : null;

async function timezoneOf(store: HarnessStore, workspaceId: string): Promise<string> {
  return (await store.getWorkspace(workspaceId))?.timezone ?? "Asia/Kolkata";
}

export async function createSchedule(store: HarnessStore, scoped: ScopedStore, input: ScheduleInput, actor: string, now = new Date()): Promise<Schedule> {
  check(input);
  const schedule: Schedule = {
    id: `sch_${randomUUID()}`,
    workspaceId: scoped.workspaceId,
    name: input.name.trim().slice(0, 120),
    trigger: input.trigger,
    goal: input.goal.trim().slice(0, 2000),
    status: "active",
    nextRunAt: null,
    lastRunAt: null,
    lastGoalId: null,
    createdBy: actor,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  schedule.nextRunAt = nextFor(schedule, now, await timezoneOf(store, scoped.workspaceId));
  await scoped.put("schedules", schedule);
  await audit(scoped, { kind: "schedule.created", actor, detail: `${schedule.name} (${describeTrigger(schedule)})`, data: { scheduleId: schedule.id } });
  return schedule;
}

export async function editSchedule(store: HarnessStore, scoped: ScopedStore, id: string, patch: Partial<ScheduleInput>, actor: string, now = new Date()): Promise<Schedule | null> {
  const current = await scoped.get("schedules", id);
  if (!current) return null;
  const merged = { name: patch.name ?? current.name, trigger: patch.trigger ?? current.trigger, goal: patch.goal ?? current.goal };
  check(merged);
  const next: Schedule = { ...current, ...merged, updatedAt: now.toISOString() };
  next.nextRunAt = nextFor(next, now, await timezoneOf(store, scoped.workspaceId));
  await scoped.put("schedules", next);
  await audit(scoped, { kind: "schedule.edited", actor, detail: `${next.name} (${describeTrigger(next)})`, data: { scheduleId: id } });
  return next;
}

export async function setScheduleStatus(store: HarnessStore, scoped: ScopedStore, id: string, status: Schedule["status"], actor: string, now = new Date()): Promise<Schedule | null> {
  const current = await scoped.get("schedules", id);
  if (!current) return null;
  const next: Schedule = { ...current, status, updatedAt: now.toISOString() };
  next.nextRunAt = nextFor(next, now, await timezoneOf(store, scoped.workspaceId));
  await scoped.put("schedules", next);
  await audit(scoped, { kind: status === "paused" ? "schedule.paused" : "schedule.resumed", actor, detail: next.name, data: { scheduleId: id } });
  return next;
}

export async function deleteSchedule(scoped: ScopedStore, id: string, actor: string): Promise<boolean> {
  const current = await scoped.get("schedules", id);
  if (!current) return false;
  await scoped.remove("schedules", id);
  await audit(scoped, { kind: "schedule.deleted", actor, detail: current.name, data: { scheduleId: id } });
  return true;
}

export const describeTrigger = (s: Pick<Schedule, "trigger">): string => (s.trigger.kind === "cron" ? `cron ${s.trigger.cron}` : `on ${s.trigger.event}`);

const MIN_INTERVAL_MS = 60_000;

/**
 * Fires one schedule: submits its goal through the runner (same intake, same
 * gate). `manual` = run-now by an operator (works while paused; skips the rate limit).
 */
export async function fireSchedule(store: HarnessStore, scoped: ScopedStore, schedule: Schedule, opts: { actor: string; manual: boolean; payload?: Record<string, unknown>; now?: Date }): Promise<{ goalId: string } | { skipped: string }> {
  const now = opts.now ?? new Date();
  const workspace = await store.getWorkspace(scoped.workspaceId);
  const skip = async (why: string) => {
    await audit(scoped, { kind: "schedule.skipped", actor: opts.actor, detail: `${schedule.name}: ${why}`, data: { scheduleId: schedule.id } });
    await notify(scoped, { kind: "schedule_skipped", title: "Schedule skipped", body: `${schedule.name}: ${why}`, ref: schedule.id });
    return { skipped: why };
  };
  if (!workspace?.enabled) return skip("the harness is switched off");
  if (!opts.manual && schedule.lastRunAt && now.getTime() - new Date(schedule.lastRunAt).getTime() < MIN_INTERVAL_MS) return { skipped: "fired less than a minute ago" };
  const runner = g.__harnessRunners?.get(store);
  if (!runner) return skip("no goal runner is wired (lib/marketing/harness/index.ts)");

  const attachments = opts.payload ? [untrusted(JSON.stringify(opts.payload), `event:${schedule.trigger.kind === "event" ? schedule.trigger.event : "manual"}`)] : [];
  const plannedOnly = workspace.autonomy === "suggest-only";
  const source = schedule.trigger.kind === "event" && !opts.manual ? `event:${schedule.trigger.event}:${schedule.id}` : `schedule:${schedule.id}`;
  await scoped.put("schedules", { ...schedule, lastRunAt: now.toISOString(), nextRunAt: nextFor(schedule, now, workspace.timezone), updatedAt: now.toISOString() });
  const result = await runner(scoped.workspaceId, { text: schedule.goal, actor: opts.actor, source, plannedOnly, attachments });
  if ("goalId" in result) {
    const latest = await scoped.get("schedules", schedule.id);
    if (latest) await scoped.put("schedules", { ...latest, lastGoalId: result.goalId });
    await audit(scoped, { kind: "schedule.fired", actor: opts.actor, goalId: result.goalId, detail: `${schedule.name} → goal ${result.goalId}${plannedOnly ? " (plan only: suggest-only)" : ""}${opts.manual ? " (run now)" : ""}`, data: { scheduleId: schedule.id } });
    await notify(scoped, { kind: "schedule_fired", title: `Schedule ran: ${schedule.name}`, body: plannedOnly ? "Planned only — this workspace is suggest-only. Review the tasks to start them." : "Running. Anything outbound will wait for your approval.", ref: result.goalId });
  }
  return result;
}

// ─── events ─────────────────────────────────────────────────────────────────

/** A listener gets the workspace, the payload, and the store the event was raised on (so it works on that harness's data). */
export type EventHandler = (workspaceId: string, payload: Record<string, unknown>, ctx: { store: HarnessStore }) => Promise<void>;

/** SEAM: a feature listens for an event inside the harness. `key` makes registration idempotent (re-registering replaces). */
export function onEvent(event: string, handler: EventHandler, key?: string): void {
  const listeners = (g.__harnessListeners ??= new Map<string, EventHandler[]>());
  const keyed = handler as EventHandler & { __key?: string };
  keyed.__key = key;
  listeners.set(event, [...(listeners.get(event) ?? []).filter((h) => !key || (h as typeof keyed).__key !== key), keyed]);
}

/** Raises an event in ONE workspace: listeners run, and that workspace's active event schedules fire. */
export async function emit(store: HarnessStore, workspaceId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const scoped = store.scope(workspaceId);
  for (const handler of g.__harnessListeners?.get(event) ?? []) {
    try {
      await handler(workspaceId, payload, { store });
    } catch (error) {
      console.warn(`[harness] listener for ${event} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  const schedules = (await scoped.list("schedules", { status: "active" })).filter((s) => s.trigger.kind === "event" && s.trigger.event === event);
  for (const s of schedules) await fireSchedule(store, scoped, s, { actor: `event:${event}`, manual: false, payload });
}

// ─── the engine loop ────────────────────────────────────────────────────────

const TICK_MS = 30_000;

/** SEAM: work a feature wants done on every engine tick (e.g. proposing sequence steps as they fall due). */
export type TickHook = (store: HarnessStore, now: Date) => Promise<void>;
const tickHooks = (): Map<string, TickHook> => ((globalThis as unknown as { __harnessTickHooks?: Map<string, TickHook> }).__harnessTickHooks ??= new Map());
export function registerTickHook(name: string, hook: TickHook): void {
  tickHooks().set(name, hook);
}
const holder = () => (g.__harnessAutomation ??= { timer: null, running: false, lastTickAt: null, lastError: null });

export function automationStatus() {
  const { timer, lastTickAt, lastError } = holder();
  return { on: Boolean(timer), lastTickAt, lastError, everySeconds: TICK_MS / 1000 };
}

/** Fires every due cron schedule, each inside its own workspace scope. */
export async function automationTick(store: HarnessStore, now = new Date()): Promise<number> {
  const h = holder();
  if (h.running) return 0;
  h.running = true;
  let fired = 0;
  try {
    for (const schedule of await store.dueSchedules(now.toISOString())) {
      const r = await fireSchedule(store, store.scope(schedule.workspaceId), schedule, { actor: `schedule:${schedule.id}`, manual: false, now });
      if ("goalId" in r) fired += 1;
    }
    for (const [name, hook] of tickHooks()) {
      try {
        await hook(store, now);
      } catch (error) {
        console.warn(`[harness] tick hook ${name} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    h.lastTickAt = new Date().toISOString();
    h.lastError = null;
  } catch (error) {
    h.lastError = error instanceof Error ? error.message : "unknown";
    console.warn("[harness] automation tick failed:", h.lastError);
  } finally {
    h.running = false;
  }
  return fired;
}

export function startAutomation(store: HarnessStore): void {
  const h = holder();
  if (h.timer) return;
  h.timer = setInterval(() => void automationTick(store), TICK_MS);
  void automationTick(store);
}
