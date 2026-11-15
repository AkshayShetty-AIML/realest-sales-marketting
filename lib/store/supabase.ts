import "server-only";
import type {
  CheckIn,
  Feedback,
  Job,
  LinkToken,
  Brochure,
  FirstReply,
  ServiceInterest,
  SequenceRun,
  VisitRecord,
  VisitSettings,
  Assignment,
  AuditEvent,
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
 * The sales app's OWN Supabase (supabase/migrations/0001_sales_schema.sql),
 * over PostgREST with the SECRET key. Every table has RLS ON and NO policies:
 * only this server (secret key) can read or write; the browser never talks to
 * this database. Reps reach data only through server components / actions
 * after Clerk auth. Rows are stored as camel→snake mapped columns.
 */

type Row = Record<string, unknown>;

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toRow = (value: object): Row => Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), v]));
const fromRow = <T>(row: Row): T => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) as T;

export function createSupabaseStore(url: string, secretKey: string): SalesStore {
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    ...extra,
  });

  async function select<T>(table: string, query: string): Promise<T[]> {
    const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: headers(), cache: "no-store" });
    if (!response.ok) throw new Error(`sales store: ${table} read failed (${response.status})`);
    return ((await response.json()) as Row[]).map((row) => fromRow<T>(row));
  }

  async function upsert(table: string, value: object | object[], onConflict: string, ignoreDuplicates = false): Promise<number> {
    const rows = Array.isArray(value) ? value.map(toRow) : [toRow(value)];
    const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}&select=${onConflict.split(",")[0]}`, {
      method: "POST",
      headers: headers({ Prefer: `return=representation,resolution=${ignoreDuplicates ? "ignore-duplicates" : "merge-duplicates"}` }),
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`sales store: ${table} write failed (${response.status})`);
    return ((await response.json()) as unknown[]).length;
  }

  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

  /** PATCH (returns rows changed) or DELETE. */
  async function patchOrDelete(method: "PATCH" | "DELETE", table: string, filter: string, patch?: object): Promise<number> {
    const response = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method,
      headers: headers({ Prefer: "return=representation" }),
      body: patch ? JSON.stringify(toRow(patch)) : undefined,
    });
    if (!response.ok) throw new Error(`sales store: ${table} ${method.toLowerCase()} failed (${response.status})`);
    return ((await response.json()) as unknown[]).length;
  }
  const first = async <T>(table: string, query: string) => (await select<T>(table, `${query}&limit=1`))[0] ?? null;

  return {
    kind: "supabase",
    listReps: () => select<Rep>("reps", "select=*&order=name.asc"),
    upsertRep: async (rep) => void (await upsert("reps", rep, "id")),
    deleteRep: async (id) => void (await patchOrDelete("DELETE", "reps", `id=${eq(id)}`)),
    listAssignments: (leadId) => select<Assignment>("assignments", `select=*${leadId ? `&lead_id=${eq(leadId)}` : ""}&order=assigned_at.asc`),
    addAssignment: async (a) => void (await upsert("assignments", a, "id")),
    getOptIn: (leadId) => first<OptIn>("opt_ins", `select=*&lead_id=${eq(leadId)}`),
    listOptIns: () => select<OptIn>("opt_ins", "select=*"),
    setOptIn: async (o) => void (await upsert("opt_ins", o, "lead_id")),
    getAutoReply: (leadId) => first<AutoReply>("auto_replies", `select=*&lead_id=${eq(leadId)}`),
    listAutoReplies: () => select<AutoReply>("auto_replies", "select=*&order=at.desc"),
    // ignore-duplicates on the primary key: 1 row back = we claimed it, 0 = someone else did.
    claimAutoReply: async (r) => (await upsert("auto_replies", r, "lead_id", true)) === 1,
    updateAutoReply: async (r) => void (await upsert("auto_replies", r, "lead_id")),
    getConversation: (leadId) => first<ConversationState>("conversations", `select=*&lead_id=${eq(leadId)}`),
    setConversation: async (s) => void (await upsert("conversations", s, "lead_id")),
    listConversations: () => select<ConversationState>("conversations", "select=*"),
    touchWaSession: async (phoneHash, at) => void (await upsert("wa_sessions", { phoneHash, lastInboundAt: at }, "phone_hash")),
    getWaSession: (phoneHash) => first<WaSession>("wa_sessions", `select=*&phone_hash=${eq(phoneHash)}`),
    addWaMessage: async (m) => void (await upsert("wa_messages", m, "id")),
    updateWaMessage: async (id, patch) => {
      const response = await fetch(`${url}/rest/v1/wa_messages?id=${eq(id)}`, {
        method: "PATCH",
        headers: headers({ Prefer: "return=minimal" }),
        body: JSON.stringify(toRow({ ...patch, updatedAt: new Date().toISOString() })),
      });
      if (!response.ok) throw new Error(`sales store: wa_messages update failed (${response.status})`);
    },
    findWaMessageBySid: (sid) => first<WaMessage>("wa_messages", `select=*&sid=${eq(sid)}`),
    claimInboundSid: async (sid) => (await upsert("wa_inbound", { sid, at: new Date().toISOString() }, "sid", true)) === 1,
    listWaMessages: (leadId) => select<WaMessage>("wa_messages", `select=*&lead_id=${eq(leadId)}&order=at.asc`),
    indexContact: async (phoneHash, leadId) => void (await upsert("contact_index", { phoneHash, leadId }, "phone_hash")),
    leadForContact: async (phoneHash) => (await first<{ leadId: string }>("contact_index", `select=lead_id&phone_hash=${eq(phoneHash)}`))?.leadId ?? null,
    listSequences: async () => (await select<Sequence>("sequences", "select=*&order=name.asc")).filter((x) => typeof x.trigger === "string"),
    upsertSequence: async (s) => void (await upsert("sequences", s, "id")),
    deleteSequence: async (id) => void (await patchOrDelete("DELETE", "sequences", `id=${eq(id)}`)),
    listRuns: (f = {}) =>
      select<SequenceRun>("sequence_runs", `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}${f.status ? `&status=eq.${f.status}` : ""}&order=started_at.asc`),
    upsertRun: async (r) => void (await upsert("sequence_runs", r, "id")),
    listJobs: (f = {}) =>
      select<Job>(
        "jobs",
        `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}${f.status ? `&status=eq.${f.status}` : ""}${f.dueBefore ? `&run_at=lte.${encodeURIComponent(f.dueBefore)}` : ""}&order=run_at.asc&limit=1000`,
      ),
    upsertJob: async (j) => void (await upsert("jobs", j, "id")),
    claimJob: async (id) => (await patchOrDelete("PATCH", "jobs", `id=${eq(id)}&status=eq.pending`, { status: "running" })) === 1,
    listVisits: (f = {}) =>
      select<VisitRecord>("visit_records", `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}${f.propertyId ? `&property_id=${eq(f.propertyId)}` : ""}&order=slot.asc`),
    upsertVisit: async (v) => void (await upsert("visit_records", v, "visit_id")),
    addCheckIn: async (c) => void (await upsert("check_ins", c, "id", true)),
    listCheckIns: (f = {}) => select<CheckIn>("check_ins", `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}${f.visitId ? `&visit_id=${eq(f.visitId)}` : ""}&order=at.asc`),
    addFeedback: async (fb) => void (await upsert("feedback", fb, "id", true)),
    listFeedback: (f = {}) => select<Feedback>("feedback", `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}${f.visitId ? `&visit_id=${eq(f.visitId)}` : ""}&order=at.asc`),
    addLink: async (l) => void (await upsert("link_tokens", l, "token", true)),
    getLink: (token) => first<LinkToken>("link_tokens", `select=*&token=${eq(token)}`),
    touchLink: async (token, usedAt) => void (await patchOrDelete("PATCH", "link_tokens", `token=${eq(token)}`, { usedAt })),
    upsertBrochure: async (b) => void (await upsert("brochures", b, "id")),
    getBrochure: (id) => first<Brochure>("brochures", `select=*&id=${eq(id)}`),
    listBrochures: (f = {}) => select<Brochure>("brochures", `select=*${f.leadId ? `&lead_id=${eq(f.leadId)}` : ""}&order=created_at.desc`),
    getVisitSettings: async () => {
      const v = await first<{ value: string }>("cursors", `select=value&name=eq.visit-settings`);
      return v ? (JSON.parse(v.value) as VisitSettings) : null;
    },
    setVisitSettings: async (settings) => void (await upsert("cursors", { name: "visit-settings", value: JSON.stringify(settings) }, "name")),
    audit: async (e) => void (await upsert("audit_events", e, "id", true)),
    listAudit: (leadId, limit = 100) =>
      select<AuditEvent>("audit_events", `select=*${leadId ? `&lead_id=${eq(leadId)}` : ""}&order=at.desc&limit=${limit}`),
    getCursor: async (name) => (await first<{ value: string }>("cursors", `select=value&name=${eq(name)}`))?.value ?? null,
    setCursor: async (name, value) => void (await upsert("cursors", { name, value }, "name")),
    getFirstReply: (leadId) => first<FirstReply>("first_replies", `select=*&lead_id=${eq(leadId)}`),
    upsertFirstReply: async (row) => void (await upsert("first_replies", row, "lead_id")),
    listFirstReplies: () => select<FirstReply>("first_replies", "select=*&order=arrived_at.desc&limit=5000"),
    addServiceInterest: async (row) => void (await upsert("service_interests", row, "id", true)),
    listServiceInterests: () => select<ServiceInterest>("service_interests", "select=*&order=at.desc"),
  };
}
