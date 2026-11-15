import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CheckIn,
  Feedback,
  Job,
  LinkToken,
  Brochure,
  SequenceRun,
  VisitRecord,
  VisitSettings,
  Assignment,
  AuditEvent,
  FirstReply,
  ServiceInterest,
  AutoReply,
  ConversationState,
  OptIn,
  Rep,
  SalesStore,
  Sequence,
  WaMessage,
  WaSession,
} from "./types";

/**
 * The LOCAL sales store: one JSON file (.data/sales-store.json, gitignored),
 * used when SALES_SUPABASE_* is unset. Fine for one localhost process —
 * writes are serialized in-process and written atomically (temp + rename).
 * Not for multi-instance deployments: use the Supabase store there.
 */

interface Data {
  reps: Rep[];
  assignments: Assignment[];
  optIns: OptIn[];
  autoReplies: AutoReply[];
  conversations: ConversationState[];
  waSessions: WaSession[];
  waMessages: WaMessage[];
  inboundSids: string[];
  runs: SequenceRun[];
  jobs: Job[];
  visits: VisitRecord[];
  checkIns: CheckIn[];
  feedback: Feedback[];
  links: LinkToken[];
  brochures: Brochure[];
  visitSettings: VisitSettings | null;
  contacts: Record<string, string>;
  sequences: Sequence[];
  audit: AuditEvent[];
  cursors: Record<string, string>;
  firstReplies: FirstReply[];
  serviceInterests: ServiceInterest[];
}

const MAX_AUDIT = 2000;

const empty = (): Data => ({
  reps: [],
  assignments: [],
  optIns: [],
  autoReplies: [],
  conversations: [],
  waSessions: [],
  waMessages: [],
  inboundSids: [],
  runs: [],
  jobs: [],
  visits: [],
  checkIns: [],
  feedback: [],
  links: [],
  brochures: [],
  visitSettings: null,
  contacts: {},
  sequences: [],
  audit: [],
  cursors: {},
  firstReplies: [],
  serviceInterests: [],
});

export function fileStorePath(): string {
  return process.env.SALES_STORE_PATH || join(/* turbopackIgnore: true */ process.cwd(), ".data", "sales-store.json");
}

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Data> {
  try {
    return { ...empty(), ...(JSON.parse(await readFile(fileStorePath(), "utf8")) as Partial<Data>) };
  } catch {
    return empty();
  }
}

async function save(data: Data): Promise<void> {
  const path = fileStorePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, path);
}

/** Read-modify-write under the in-process lock. */
function mutate<T>(change: (data: Data) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await load();
    const result = change(data);
    await save(data);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

function upsertBy<T>(list: T[], item: T, same: (a: T) => boolean): void {
  const index = list.findIndex(same);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

export function createFileStore(): SalesStore {
  return {
    kind: "file",
    listReps: async () => (await load()).reps,
    upsertRep: (rep) => mutate((d) => upsertBy(d.reps, rep, (r) => r.id === rep.id)),
    listAssignments: async (leadId) => (await load()).assignments.filter((a) => !leadId || a.leadId === leadId),
    addAssignment: (assignment) => mutate((d) => void d.assignments.push(assignment)),
    getOptIn: async (leadId) => (await load()).optIns.find((o) => o.leadId === leadId) ?? null,
    listOptIns: async () => (await load()).optIns,
    setOptIn: (optIn) => mutate((d) => upsertBy(d.optIns, optIn, (o) => o.leadId === optIn.leadId)),
    getAutoReply: async (leadId) => (await load()).autoReplies.find((r) => r.leadId === leadId) ?? null,
    listAutoReplies: async () => (await load()).autoReplies,
    claimAutoReply: (reply) =>
      mutate((d) => {
        if (d.autoReplies.some((r) => r.leadId === reply.leadId)) return false;
        d.autoReplies.push(reply);
        return true;
      }),
    updateAutoReply: (reply) => mutate((d) => upsertBy(d.autoReplies, reply, (r) => r.leadId === reply.leadId)),
    getConversation: async (leadId) => (await load()).conversations.find((c) => c.leadId === leadId) ?? null,
    setConversation: (state) => mutate((d) => upsertBy(d.conversations, state, (c) => c.leadId === state.leadId)),
    listConversations: async () => (await load()).conversations,
    touchWaSession: (phoneHash, at) => mutate((d) => upsertBy(d.waSessions, { phoneHash, lastInboundAt: at }, (x) => x.phoneHash === phoneHash)),
    getWaSession: async (phoneHash) => (await load()).waSessions.find((x) => x.phoneHash === phoneHash) ?? null,
    addWaMessage: (message) => mutate((d) => void d.waMessages.push(message)),
    updateWaMessage: (id, patch) =>
      mutate((d) => {
        const m = d.waMessages.find((x) => x.id === id);
        if (m) Object.assign(m, patch, { updatedAt: new Date().toISOString() });
      }),
    findWaMessageBySid: async (sid) => (await load()).waMessages.find((x) => x.sid === sid) ?? null,
    claimInboundSid: (sid) =>
      mutate((d) => {
        d.inboundSids ??= [];
        if (d.inboundSids.includes(sid)) return false;
        d.inboundSids.push(sid);
        if (d.inboundSids.length > 5000) d.inboundSids.splice(0, d.inboundSids.length - 5000);
        return true;
      }),
    listWaMessages: async (leadId) => (await load()).waMessages.filter((x) => x.leadId === leadId),
    indexContact: (phoneHash, leadId) => mutate((d) => void (d.contacts[phoneHash] = leadId)),
    leadForContact: async (phoneHash) => (await load()).contacts[phoneHash] ?? null,
    // Batch-1 "planned" sequences had no trigger; they're not runnable, so they're not listed.
    listSequences: async () => (await load()).sequences.filter((s) => typeof (s as { trigger?: unknown }).trigger === "string"),
    deleteRep: (id) => mutate((d) => void (d.reps = d.reps.filter((r) => r.id !== id))),
    upsertSequence: (sequence) => mutate((d) => upsertBy(d.sequences, sequence, (s) => s.id === sequence.id)),
    deleteSequence: (id) => mutate((d) => void (d.sequences = d.sequences.filter((s) => s.id !== id))),
    listRuns: async (f = {}) => (await load()).runs.filter((r) => (!f.leadId || r.leadId === f.leadId) && (!f.status || r.status === f.status)),
    upsertRun: (run) => mutate((d) => upsertBy(d.runs, run, (r) => r.id === run.id)),
    listJobs: async (f = {}) =>
      (await load()).jobs
        .filter((j) => (!f.leadId || j.leadId === f.leadId) && (!f.status || j.status === f.status) && (!f.dueBefore || j.runAt <= f.dueBefore))
        .sort((a, b) => a.runAt.localeCompare(b.runAt)),
    upsertJob: (job) => mutate((d) => upsertBy(d.jobs, job, (j) => j.id === job.id)),
    claimJob: (id) =>
      mutate((d) => {
        const job = d.jobs.find((j) => j.id === id);
        if (!job || job.status !== "pending") return false;
        job.status = "running";
        return true;
      }),
    listVisits: async (f = {}) => (await load()).visits.filter((v) => (!f.leadId || v.leadId === f.leadId) && (!f.propertyId || v.propertyId === f.propertyId)),
    upsertVisit: (visit) => mutate((d) => upsertBy(d.visits, visit, (v) => v.visitId === visit.visitId)),
    addCheckIn: (c) => mutate((d) => void d.checkIns.push(c)),
    listCheckIns: async (f = {}) => (await load()).checkIns.filter((c) => (!f.leadId || c.leadId === f.leadId) && (!f.visitId || c.visitId === f.visitId)),
    addFeedback: (fb) => mutate((d) => void d.feedback.push(fb)),
    listFeedback: async (f = {}) => (await load()).feedback.filter((x) => (!f.leadId || x.leadId === f.leadId) && (!f.visitId || x.visitId === f.visitId)),
    addLink: (link) => mutate((d) => void d.links.push(link)),
    getLink: async (token) => (await load()).links.find((l) => l.token === token) ?? null,
    touchLink: (token, usedAt) =>
      mutate((d) => {
        const l = d.links.find((x) => x.token === token);
        if (l) l.usedAt = usedAt;
      }),
    upsertBrochure: (b) => mutate((d) => upsertBy(d.brochures, b, (x) => x.id === b.id)),
    getBrochure: async (id) => (await load()).brochures.find((b) => b.id === id) ?? null,
    listBrochures: async (f = {}) => (await load()).brochures.filter((b) => !f.leadId || b.leadId === f.leadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    getVisitSettings: async () => (await load()).visitSettings,
    setVisitSettings: (settings) => mutate((d) => void (d.visitSettings = settings)),
    audit: (event) =>
      mutate((d) => {
        d.audit.push(event);
        if (d.audit.length > MAX_AUDIT) d.audit.splice(0, d.audit.length - MAX_AUDIT);
      }),
    listAudit: async (leadId, limit = 100) =>
      (await load()).audit
        .filter((e) => !leadId || e.leadId === leadId)
        .slice(-limit)
        .reverse(),
    getCursor: async (name) => (await load()).cursors[name] ?? null,
    setCursor: (name, value) => mutate((d) => void (d.cursors[name] = value)),
    getFirstReply: async (leadId) => (await load()).firstReplies.find((r) => r.leadId === leadId) ?? null,
    upsertFirstReply: (row) => mutate((d) => upsertBy(d.firstReplies, row, (r) => r.leadId === row.leadId)),
    listFirstReplies: async () => (await load()).firstReplies,
    addServiceInterest: (row) => mutate((d) => void d.serviceInterests.push(row)),
    listServiceInterests: async () => (await load()).serviceInterests,
  };
}
