import "server-only";
import { premium } from "./premium/client";
import { store } from "./store";
import type { ProjectCompliance } from "./store/types";

/**
 * ADVERTISING COMPLIANCE ON EVERY OUTBOUND MESSAGE. A project carries its RERA
 * registration number, or — where RERA doesn't apply — an exemption
 * statement with the reason and an evidence reference (Brand settings →
 * Projects). Every message the desk sends on a project ends with that line;
 * where AI wrote the message, an AI label too. With neither set, nothing
 * goes out (OutboundBlocked).
 *
 * Where the line comes from, in order:
 *   1. the project's setting in Brand settings (this app's store);
 *   2. the RERA number premium holds for the project (`reraNumber`).
 * Premium's single brand-kit default is NOT used: it isn't any one project's.
 */

export const reraLine = (reraRegNo: string) => `RERA Reg. No.: ${reraRegNo}`;
export const exemptionLine = (e: { statement: string; reason: string; evidenceRef: string }) => `RERA: ${e.statement} — reason: ${e.reason}; ref. ${e.evidenceRef}`;
export const AI_REPLY_LABEL = "AI-assisted reply";

export type Compliance =
  | { kind: "rera"; reraRegNo: string; line: string; source: "brand-settings" | "premium" }
  | { kind: "exempt"; line: string; reason: string; evidenceRef: string; source: "brand-settings" };

export class OutboundBlocked extends Error {
  override name = "OutboundBlocked";
}

export function fromSetting(row: ProjectCompliance): Compliance | null {
  if (row.mode === "rera" && row.reraRegNo?.trim()) return { kind: "rera", reraRegNo: row.reraRegNo.trim(), line: reraLine(row.reraRegNo.trim()), source: "brand-settings" };
  if (row.mode === "exempt" && row.exemption) return { kind: "exempt", line: exemptionLine(row.exemption), reason: row.exemption.reason, evidenceRef: row.exemption.evidenceRef, source: "brand-settings" };
  return null;
}

/** The project's compliance line, or null when neither a RERA number nor an exemption is known. `property`: when the caller already read it from the shared store. */
export async function complianceFor(projectId: string, property?: { reraNumber?: string | null }): Promise<Compliance | null> {
  const row = await store().getProjectCompliance(projectId);
  const set = row ? fromSetting(row) : null;
  if (set) return set;
  const fromPremium = (p: { reraNumber?: string | null }) => (typeof p.reraNumber === "string" && p.reraNumber.trim() ? p.reraNumber.trim() : null);
  const rera = property ? fromPremium(property) : await premium.getProperty(projectId).then(fromPremium).catch(() => null);
  return rera ? { kind: "rera", reraRegNo: rera, line: reraLine(rera), source: "premium" } : null;
}

/** Already carries a compliance line (any RERA number or an exemption) — never a second one. */
export const hasComplianceLine = (body: string) => /(^|\n)RERA( Reg\. No\.)?: /.test(body);
export const hasAiLabel = (body: string) => /\bAI\b/.test(body);

/** The body as it must go out: + the AI label where AI wrote it, + the compliance line (last). */
export function applyCompliance(body: string, compliance: Compliance, opts: { ai?: boolean } = {}): string {
  let out = body.trimEnd();
  if (opts.ai && !hasAiLabel(out)) out = `${out}\n\n${AI_REPLY_LABEL}`;
  if (!hasComplianceLine(out)) out = `${out}\n\n${compliance.line}`;
  return out;
}

/** For one lead's message: resolves the lead's project and applies its line — or throws OutboundBlocked. */
export async function compliantBody(leadId: string, body: string, opts: { ai?: boolean; projectId?: string } = {}): Promise<string> {
  if (hasComplianceLine(body) && (!opts.ai || hasAiLabel(body))) return body;
  const projectId = opts.projectId ?? (await premium.getLead(leadId)).propertyId;
  const c = await complianceFor(projectId);
  if (!c) throw new OutboundBlocked("Not sent: this project has no RERA registration number or exemption — add one in Brand settings → Projects.");
  return applyCompliance(body, c, opts);
}
