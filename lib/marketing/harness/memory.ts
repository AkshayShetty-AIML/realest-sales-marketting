import "server-only";
import { randomUUID } from "node:crypto";
import type { ScopedStore } from "./store";
import { LOCAL_COPY_KINDS, type MemoryItem, type MemoryKind } from "./types";

/**
 * 2 · COMPANY MEMORY — not personal. One workspace's durable knowledge:
 * brand kit, inventory / projects, audiences / segments, campaigns, leads,
 * and an append-only DECISIONS + LEARNINGS store — with retrieval.
 *
 * Scoped: a WorkspaceMemory is built from a ScopedStore, so it can only ever
 * read and write its own workspace's items.
 *
 * Items carry `trust`. Third-party content (a lead's message) is stored
 * "untrusted" and the runtime fences it whenever it reaches a model
 * (trust.ts → fenceUntrusted).
 *
 * SEAM — retrieval: the default retriever is lexical (BM25-style over title,
 * text and tags). setRetriever() swaps in an embedding / vector retriever
 * without touching callers; it still only receives this workspace's items.
 */

export interface Retrieved {
  item: MemoryItem;
  score: number;
}

export interface RetrieveOptions {
  kinds?: MemoryKind[];
  limit?: number;
  /** Default true; false drops third-party content entirely. */
  includeUntrusted?: boolean;
}

export interface Retriever {
  readonly name: string;
  rank(query: string, items: MemoryItem[], limit: number): Promise<Retrieved[]>;
}

export interface MemoryInput {
  kind: MemoryKind;
  key: string;
  title: string;
  data?: Record<string, unknown>;
  /** Searchable text; defaults to the title plus the data's string values. */
  text?: string;
  tags?: string[];
  trust?: MemoryItem["trust"];
  source: string;
  demo?: boolean;
}

export interface WorkspaceMemory {
  readonly workspaceId: string;
  upsert(input: MemoryInput): Promise<MemoryItem>;
  get(kind: MemoryKind, key: string): Promise<MemoryItem | null>;
  list(kind?: MemoryKind | MemoryKind[]): Promise<MemoryItem[]>;
  remove(kind: MemoryKind, key: string): Promise<void>;
  retrieve(query: string, options?: RetrieveOptions): Promise<Retrieved[]>;
  /** Durable, append-only: what was decided, by whom, and why. */
  recordDecision(input: { title: string; rationale: string; by: string; goalId?: string | null; data?: Record<string, unknown> }): Promise<MemoryItem>;
  /** Durable, append-only: what worked / didn't, with its evidence. */
  recordLearning(input: { title: string; insight: string; evidence?: string; source: string; goalId?: string | null; data?: Record<string, unknown> }): Promise<MemoryItem>;
}

// ─── retrieval ──────────────────────────────────────────────────────────────

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "our", "your", "into", "about", "what", "which", "will"]);
export const tokens = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

/** BM25 over each item's title (×2), tags and text. */
export const lexicalRetriever: Retriever = {
  name: "lexical-bm25",
  async rank(query, items, limit) {
    const q = Array.from(new Set(tokens(query)));
    if (q.length === 0) return items.slice(0, limit).map((item) => ({ item, score: 0 }));
    const docs = items.map((item) => tokens(`${item.title} ${item.title} ${item.tags.join(" ")} ${item.text}`));
    const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1) || 1;
    const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
    const k1 = 1.2;
    const b = 0.75;
    return items
      .map((item, i) => {
        const d = docs[i];
        let score = 0;
        for (const t of q) {
          const tf = d.filter((w) => w === t).length;
          if (!tf) continue;
          const idf = Math.log(1 + (items.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avg)));
        }
        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit);
  },
};

let retriever: Retriever = lexicalRetriever;
/** SEAM: replace the retriever (e.g. embeddings). */
export function setRetriever(next: Retriever): void {
  retriever = next;
}
export const activeRetriever = (): string => retriever.name;

// ─── the workspace memory ───────────────────────────────────────────────────

/** A lead / building / unit / inventory copy offered to company memory — refused (the shared stores are the only source). */
export class LocalCopyRefused extends Error {
  override name = "LocalCopyRefused";
}

const itemId = (kind: string, key: string) => `${kind}:${key}`;
const defaultText = (title: string, data: Record<string, unknown>) =>
  [title, ...Object.values(data).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : []))].join(" \n");

export function workspaceMemory(scoped: ScopedStore, clock: () => string = () => new Date().toISOString()): WorkspaceMemory {
  const workspaceId = scoped.workspaceId;

  async function upsert(input: MemoryInput): Promise<MemoryItem> {
    if ((LOCAL_COPY_KINDS as readonly string[]).includes(String(input.kind).toLowerCase())) throw new LocalCopyRefused(`company memory keeps no "${input.kind}" copies — leads and inventory are read from the shared store`);
    const id = itemId(input.kind, input.key);
    const existing = await scoped.get("memory_items", id);
    const now = clock();
    const data = input.data ?? {};
    const item: MemoryItem = {
      id,
      workspaceId,
      kind: input.kind,
      key: input.key,
      title: input.title,
      data,
      text: input.text ?? defaultText(input.title, data),
      tags: input.tags ?? [],
      trust: input.trust ?? "trusted",
      source: input.source,
      ...(input.demo ? { demo: true } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await scoped.put("memory_items", item);
    return item;
  }

  return {
    workspaceId,
    upsert,
    get: (kind, key) => scoped.get("memory_items", itemId(kind, key)),
    list: (kind) => scoped.list("memory_items", kind ? { kind: kind as string | string[] } : {}),
    remove: (kind, key) => scoped.remove("memory_items", itemId(kind, key)),
    async retrieve(query, options = {}) {
      let items = await scoped.list("memory_items", options.kinds ? { kind: options.kinds as string[] } : {});
      if (options.includeUntrusted === false) items = items.filter((i) => i.trust === "trusted");
      return retriever.rank(query, items, options.limit ?? 8);
    },
    recordDecision: (d) =>
      upsert({
        kind: "decision",
        key: randomUUID(),
        title: d.title,
        data: { rationale: d.rationale, by: d.by, goalId: d.goalId ?? null, ...d.data },
        text: `${d.title}\n${d.rationale}`,
        source: d.by,
      }),
    recordLearning: (l) =>
      upsert({
        kind: "learning",
        key: randomUUID(),
        title: l.title,
        data: { insight: l.insight, evidence: l.evidence ?? null, goalId: l.goalId ?? null, ...l.data },
        text: `${l.title}\n${l.insight}\n${l.evidence ?? ""}`,
        source: l.source,
      }),
  };
}
