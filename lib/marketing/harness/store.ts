import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { salesSupabaseConfig } from "../../env";
import type { Approval, AuditEntry, Checkpoint, Goal, MemoryItem, Notification, Schedule, SubagentRun, Task, ToolSetting, Workspace } from "./types";

/**
 * THE HARNESS'S STATE — workspace-scoped, three backends behind one interface:
 *
 *  - supabase: supabase/migrations/0006_marketing_harness.sql (this app's own
 *    Supabase, secret key, RLS on / no policies — server only). Every scoped
 *    table's primary key is (workspace_id, id).
 *  - file: .data/marketing-harness.json, for one localhost process (the same
 *    approach as lib/store/file.ts).
 *  - memory: in-process, for tests.
 *
 * TENANT ISOLATION: modules never hold the raw store — they get `scope(id)`,
 * a ScopedStore bound to ONE workspace. Every read filters by it and every
 * write is refused if the row names another workspace. The only cross-tenant
 * read is `dueSchedules`, for the automation engine, which then works inside
 * each schedule's own workspace scope.
 */

export interface RowMap {
  goals: Goal;
  tasks: Task;
  subagent_runs: SubagentRun;
  tool_registry: ToolSetting;
  approvals: Approval;
  audit_log: AuditEntry;
  checkpoints: Checkpoint;
  schedules: Schedule;
  memory_items: MemoryItem;
  notifications: Notification;
}
export type ScopedTable = keyof RowMap;
export const SCOPED_TABLES: ScopedTable[] = ["goals", "tasks", "subagent_runs", "tool_registry", "approvals", "audit_log", "checkpoints", "schedules", "memory_items", "notifications"];

export interface Filter {
  status?: string | string[];
  /** memory_items / audit_log / notifications: their `kind`. */
  kind?: string | string[];
  goalId?: string;
  limit?: number;
  /** By time (at / createdAt / startedAt / updatedAt). Default asc. */
  order?: "asc" | "desc";
}

export interface ScopedStore {
  readonly workspaceId: string;
  list<T extends ScopedTable>(table: T, filter?: Filter): Promise<RowMap[T][]>;
  get<T extends ScopedTable>(table: T, id: string): Promise<RowMap[T] | null>;
  put<T extends ScopedTable>(table: T, row: RowMap[T]): Promise<void>;
  remove(table: ScopedTable, id: string): Promise<void>;
  /** Compare-and-set: applies `patch` only while the row's status is one of `from`. Null = someone else moved it. */
  transition<T extends ScopedTable>(table: T, id: string, from: string[], patch: Partial<RowMap[T]>): Promise<RowMap[T] | null>;
}

export interface HarnessStore {
  readonly kind: "memory" | "file" | "supabase";
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(): Promise<Workspace[]>;
  putWorkspace(workspace: Workspace): Promise<void>;
  /** Removes a workspace AND every row it owns (goals, tasks, runs, approvals, audit, checkpoints, schedules, memory, notifications). */
  deleteWorkspace(id: string): Promise<void>;
  scope(workspaceId: string): ScopedStore;
  /** SYSTEM read for the automation engine: active cron schedules due before `before`, across workspaces. */
  dueSchedules(before: string): Promise<Schedule[]>;
}

type AnyRow = { id: string; workspaceId: string; status?: string; kind?: string; goalId?: string | null } & Record<string, unknown>;

const sortAt = (row: Record<string, unknown>): string => String(row.at ?? row.createdAt ?? row.startedAt ?? row.updatedAt ?? "");
const asList = (v: string | string[] | undefined) => (v === undefined ? null : Array.isArray(v) ? v : [v]);

export class CrossWorkspaceWrite extends Error {
  constructor(table: string, expected: string, got: string) {
    super(`refused: a ${table} row for workspace ${got} written through workspace ${expected}'s scope`);
  }
}

function matches(row: AnyRow, filter: Filter): boolean {
  const status = asList(filter.status);
  const kind = asList(filter.kind);
  return (!status || status.includes(String(row.status))) && (!kind || kind.includes(String(row.kind))) && (!filter.goalId || row.goalId === filter.goalId);
}

// ─── memory + file (one implementation, optional persistence) ───────────────

interface Data {
  workspaces: Workspace[];
  tables: Record<string, AnyRow[]>;
}
const emptyData = (): Data => ({ workspaces: [], tables: {} });

function createDocStore(kind: "memory" | "file", io: { load(): Promise<Data>; save(d: Data): Promise<void> }): HarnessStore {
  let queue: Promise<unknown> = Promise.resolve();
  /** Read-modify-write under the in-process lock (so transition() is atomic). */
  const mutate = <T>(change: (d: Data) => T): Promise<T> => {
    const run = queue.then(async () => {
      const d = await io.load();
      const result = change(d);
      await io.save(d);
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  };
  const rows = (d: Data, table: string) => (d.tables[table] ??= []);
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    kind,
    getWorkspace: async (id) => clone((await io.load()).workspaces.find((w) => w.id === id) ?? null),
    listWorkspaces: async () => clone((await io.load()).workspaces),
    putWorkspace: (w) =>
      mutate((d) => {
        const i = d.workspaces.findIndex((x) => x.id === w.id);
        if (i >= 0) d.workspaces[i] = clone(w);
        else d.workspaces.push(clone(w));
      }),
    deleteWorkspace: (id) =>
      mutate((d) => {
        d.workspaces = d.workspaces.filter((w) => w.id !== id);
        for (const table of Object.keys(d.tables)) d.tables[table] = d.tables[table].filter((r) => r.workspaceId !== id);
      }),
    dueSchedules: async (before) =>
      clone(((await io.load()).tables.schedules ?? []) as unknown as Schedule[]).filter((s) => s.status === "active" && s.trigger.kind === "cron" && s.nextRunAt !== null && s.nextRunAt <= before),
    scope(workspaceId) {
      return {
        workspaceId,
        list: async (table, filter = {}) => {
          const list = rows(await io.load(), table).filter((r) => r.workspaceId === workspaceId && matches(r, filter));
          list.sort((a, b) => sortAt(a).localeCompare(sortAt(b)) * (filter.order === "desc" ? -1 : 1));
          return clone(filter.limit ? list.slice(0, filter.limit) : list) as never;
        },
        get: async (table, id) => clone(rows(await io.load(), table).find((r) => r.workspaceId === workspaceId && r.id === id) ?? null) as never,
        put: (table, row) => {
          const r = row as unknown as AnyRow;
          if (r.workspaceId !== workspaceId) return Promise.reject(new CrossWorkspaceWrite(table, workspaceId, r.workspaceId));
          return mutate((d) => {
            const list = rows(d, table);
            const i = list.findIndex((x) => x.workspaceId === workspaceId && x.id === r.id);
            if (i >= 0) list[i] = clone(r);
            else list.push(clone(r));
          });
        },
        remove: (table, id) =>
          mutate((d) => {
            d.tables[table] = rows(d, table).filter((x) => !(x.workspaceId === workspaceId && x.id === id));
          }),
        transition: (table, id, from, patch) =>
          mutate((d) => {
            const list = rows(d, table);
            const i = list.findIndex((x) => x.workspaceId === workspaceId && x.id === id);
            if (i < 0 || !from.includes(String(list[i].status))) return null;
            list[i] = { ...list[i], ...clone(patch as Record<string, unknown>), id, workspaceId };
            return clone(list[i]) as never;
          }),
      };
    },
  };
}

export function createMemoryHarnessStore(): HarnessStore {
  let data = emptyData();
  return createDocStore("memory", { load: async () => data, save: async (d) => void (data = d) });
}

export function harnessFilePath(): string {
  return process.env.HARNESS_STORE_PATH || join(/* turbopackIgnore: true */ process.cwd(), ".data", "marketing-harness.json");
}

export function createFileHarnessStore(path = harnessFilePath()): HarnessStore {
  return createDocStore("file", {
    load: async () => {
      try {
        return { ...emptyData(), ...(JSON.parse(await readFile(path, "utf8")) as Partial<Data>) };
      } catch {
        return emptyData();
      }
    },
    save: async (d) => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(d), "utf8");
      await rename(tmp, path);
    },
  });
}

// ─── supabase ───────────────────────────────────────────────────────────────

/**
 * Scoped tables share one shape: (workspace_id, id) primary key, the columns
 * filters use (status, kind, goal_id, sort_at), and the full row in `data`.
 */
export function createSupabaseHarnessStore(url: string, secretKey: string): HarnessStore {
  const headers = (extra: Record<string, string> = {}) => ({ apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", ...extra });
  const eq = (v: string) => `eq.${encodeURIComponent(v)}`;
  const inList = (vs: string[]) => `in.(${vs.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;
  async function request<T>(method: string, path: string, body?: unknown, prefer?: string): Promise<T> {
    const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    if (!response.ok) throw new Error(`harness store: ${method} ${path.split("?")[0]} failed (${response.status})`);
    return (response.status === 204 ? [] : await response.json()) as T;
  }
  const toRow = (table: string, row: AnyRow) => ({
    workspace_id: row.workspaceId,
    id: row.id,
    status: row.status ?? null,
    kind: row.kind ?? null,
    goal_id: row.goalId ?? null,
    sort_at: sortAt(row) || new Date().toISOString(),
    data: row,
    ...(table === "schedules" ? { next_run_at: (row as unknown as Schedule).nextRunAt, trigger_kind: (row as unknown as Schedule).trigger.kind } : {}),
  });
  const wsRow = (w: Workspace) => ({ id: w.id, name: w.name, enabled: w.enabled, autonomy: w.autonomy, members: w.members, data: w, updated_at: w.updatedAt });

  return {
    kind: "supabase",
    getWorkspace: async (id) => (await request<{ data: Workspace }[]>("GET", `workspaces?select=data&id=${eq(id)}&limit=1`))[0]?.data ?? null,
    listWorkspaces: async () => (await request<{ data: Workspace }[]>("GET", "workspaces?select=data&order=name.asc")).map((r) => r.data),
    putWorkspace: async (w) => void (await request("POST", "workspaces?on_conflict=id", [wsRow(w)], "return=minimal,resolution=merge-duplicates")),
    // Every scoped table references workspaces(id) ON DELETE CASCADE (migration 0006).
    deleteWorkspace: async (id) => void (await request("DELETE", `workspaces?id=${eq(id)}`, undefined, "return=minimal")),
    dueSchedules: async (before) =>
      (await request<{ data: Schedule }[]>("GET", `schedules?select=data&status=eq.active&trigger_kind=eq.cron&next_run_at=lte.${encodeURIComponent(before)}&limit=500`)).map((r) => r.data),
    scope(workspaceId) {
      const t = (table: string) => table;
      const where = (filter: Filter) => {
        const status = asList(filter.status);
        const kind = asList(filter.kind);
        return `workspace_id=${eq(workspaceId)}${status ? `&status=${inList(status)}` : ""}${kind ? `&kind=${inList(kind)}` : ""}${filter.goalId ? `&goal_id=${eq(filter.goalId)}` : ""}`;
      };
      return {
        workspaceId,
        list: async (table, filter = {}) =>
          (await request<{ data: never }[]>("GET", `${t(table)}?select=data&${where(filter)}&order=sort_at.${filter.order ?? "asc"}&limit=${filter.limit ?? 5000}`)).map((r) => r.data),
        get: async (table, id) => (await request<{ data: never }[]>("GET", `${t(table)}?select=data&workspace_id=${eq(workspaceId)}&id=${eq(id)}&limit=1`))[0]?.data ?? null,
        put: async (table, row) => {
          const r = row as unknown as AnyRow;
          if (r.workspaceId !== workspaceId) throw new CrossWorkspaceWrite(table, workspaceId, r.workspaceId);
          await request("POST", `${t(table)}?on_conflict=workspace_id,id`, [toRow(table, r)], "return=minimal,resolution=merge-duplicates");
        },
        remove: async (table, id) => void (await request("DELETE", `${t(table)}?workspace_id=${eq(workspaceId)}&id=${eq(id)}`, undefined, "return=minimal")),
        transition: async (table, id, from, patch) => {
          const current = (await request<{ data: AnyRow }[]>("GET", `${t(table)}?select=data&workspace_id=${eq(workspaceId)}&id=${eq(id)}&limit=1`))[0]?.data;
          if (!current || !from.includes(String(current.status))) return null;
          const next = { ...current, ...(patch as Record<string, unknown>), id, workspaceId } as AnyRow;
          // The status filter makes the PATCH the compare-and-set: 0 rows back = someone else moved it.
          const changed = await request<unknown[]>("PATCH", `${t(table)}?workspace_id=${eq(workspaceId)}&id=${eq(id)}&status=${inList(from)}`, toRow(table, next), "return=representation");
          return changed.length === 1 ? (next as never) : null;
        },
      };
    },
  };
}

// ─── the default instance ───────────────────────────────────────────────────

const g = globalThis as unknown as { __harnessStore?: HarnessStore };

/** This app's own Supabase when configured, else the local file. */
export function harnessStore(): HarnessStore {
  if (g.__harnessStore) return g.__harnessStore;
  const supabase = salesSupabaseConfig();
  g.__harnessStore = supabase ? createSupabaseHarnessStore(supabase.url, supabase.secretKey) : createFileHarnessStore();
  return g.__harnessStore;
}
