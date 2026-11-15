import "server-only";
import { randomUUID } from "node:crypto";
import { salesSupabaseConfig } from "../env";
import { createFileStore } from "./file";
import { createSupabaseStore } from "./supabase";
import type { SalesStore } from "./types";

export type * from "./types";

let instance: SalesStore | null = null;

/** The sales store: own Supabase when SALES_SUPABASE_URL + SALES_SUPABASE_SECRET_KEY are set, else the local file. */
export function store(): SalesStore {
  if (instance) return instance;
  const supabase = salesSupabaseConfig();
  instance = supabase ? createSupabaseStore(supabase.url, supabase.secretKey) : createFileStore();
  return instance;
}

/** Appends to the audit log; never lets an audit failure break the action it records. */
export async function audit(kind: string, leadId: string | null, actor: string, detail: string): Promise<void> {
  try {
    await store().audit({ id: randomUUID(), at: new Date().toISOString(), kind, leadId, actor, detail });
  } catch (error) {
    console.warn("[audit] failed:", error instanceof Error ? error.message : error);
  }
}
