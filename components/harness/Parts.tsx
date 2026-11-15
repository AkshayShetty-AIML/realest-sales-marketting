import Link from "next/link";
import type { ReactNode } from "react";
import type { AgentNode, Approval, NodeStatus, RunStep, SubagentRun, TaskView } from "@/lib/marketing/console/read";
import { AlertIcon, ArrowRightIcon, ShieldIcon } from "@/components/icons";
import { ago } from "@/lib/time";
import { agentWord, OUTBOUND_WORD } from "./words";
import { toFriendly } from "@/lib/marketing/labels";

/**
 * Presentational parts of the Agent Operations Console (asset sheet:
 * control-room surfaces on the warm canvas, deep-forest accent; status
 * colours from the mockup legend). Server-safe — no hooks, no fetching.
 */

// ─── status ─────────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; box: string; dot: string }> = {
  running: { label: "Running", box: "bg-status-run-bg text-status-run", dot: "bg-status-run" },
  doing: { label: "Doing", box: "bg-status-run-bg text-status-run", dot: "bg-status-run" },
  planning: { label: "Planning", box: "bg-surface-alt text-body", dot: "bg-status-idle" },
  planned: { label: "Planned", box: "bg-surface-alt text-body", dot: "bg-status-idle" },
  todo: { label: "To do", box: "bg-surface-alt text-body", dot: "bg-status-idle" },
  idle: { label: "Idle", box: "bg-surface-alt text-body", dot: "bg-status-idle" },
  waiting: { label: "Waiting", box: "bg-trust-caution-bg text-trust-caution", dot: "bg-ochre" },
  blocked: { label: "Blocked", box: "bg-trust-caution-bg text-trust-caution", dot: "bg-ochre" },
  pending: { label: "Waiting for you", box: "bg-trust-caution-bg text-trust-caution", dot: "bg-ochre" },
  done: { label: "Done", box: "bg-trust-good-bg text-trust-good", dot: "bg-forest" },
  approved: { label: "Approved", box: "bg-trust-good-bg text-trust-good", dot: "bg-forest" },
  active: { label: "Active", box: "bg-trust-good-bg text-trust-good", dot: "bg-forest" },
  failed: { label: "Failed", box: "bg-trust-risk-bg text-trust-risk", dot: "bg-trust-risk-fill" },
  declined: { label: "Declined", box: "bg-trust-risk-bg text-trust-risk", dot: "bg-trust-risk-fill" },
  cancelled: { label: "Cancelled", box: "bg-surface-alt text-muted", dot: "bg-status-idle" },
  expired: { label: "Expired", box: "bg-surface-alt text-muted", dot: "bg-status-idle" },
  paused: { label: "Paused", box: "bg-surface-alt text-body", dot: "bg-status-idle" },
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${s.box}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "running" || status === "doing" ? "animate-pulse" : ""}`} />
      {label ?? s.label}
    </span>
  );
}

export function Marker({ tone, children, title }: { tone: "approval" | "dry" | "tainted" | "neutral"; children: ReactNode; title?: string }) {
  const box = { approval: "bg-trust-caution-bg text-trust-caution", dry: "bg-status-dry-bg text-status-dry", tainted: "bg-trust-risk-bg text-trust-risk", neutral: "bg-surface-alt text-body" }[tone];
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] px-2 py-0.5 text-[11px] font-semibold ${box}`}>{children}</span>;
}

// ─── tiles + cards ──────────────────────────────────────────────────────────

export function StatTile({ icon, value, label, tone = "brand" }: { icon: ReactNode; value: number | string; label: string; tone?: "brand" | "run" | "caution" | "violet" }) {
  const wash = { brand: "bg-mint-light text-brand", run: "bg-status-run-bg text-status-run", caution: "bg-trust-caution-bg text-trust-caution", violet: "bg-status-dry-bg text-status-dry" }[tone];
  return (
    <div className="card flex items-center gap-4 px-5 py-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${wash}`}>{icon}</span>
      <div>
        <p className="font-tabular text-[26px] font-semibold leading-none text-ink">{value}</p>
        <p className="mt-1.5 text-[13px] text-body">{label}</p>
      </div>
    </div>
  );
}

export function Panel({ title, action, children, className = "", bodyClassName = "p-5 pt-3" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`card flex min-w-0 flex-col ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line-strong bg-surface-alt/60 px-5 py-8 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-[13px] text-body">{children}</div>}
    </div>
  );
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "W";

// ─── the agent graph (virtual office) ───────────────────────────────────────

const NODE: Record<NodeStatus, { ring: string; dot: string; line: string; dash?: string }> = {
  running: { ring: "border-status-run/50 bg-status-run-bg", dot: "bg-status-run animate-pulse", line: "var(--color-status-run)" },
  idle: { ring: "border-line-strong bg-surface", dot: "bg-status-idle", line: "var(--color-line-strong)", dash: "1.2 1.2" },
  blocked: { ring: "border-ochre/50 bg-trust-caution-bg", dot: "bg-ochre", line: "var(--color-ochre)", dash: "2 1.2" },
  done: { ring: "border-forest/40 bg-trust-good-bg", dot: "bg-forest", line: "var(--color-forest)" },
  failed: { ring: "border-rust/50 bg-trust-risk-bg", dot: "bg-trust-risk-fill", line: "var(--color-rust)" },
};

/**
 * ONE node per REGISTERED agent type (from the harness registry — never a
 * fixed roster), arranged around the orchestrator. Colour = live status from
 * this mission's runs and tasks; ⚠ = touched untrusted input.
 */
export function AgentGraph({ nodes, hrefFor, selected, height = 360 }: { nodes: AgentNode[]; hrefFor: (n: AgentNode) => string; selected?: string | null; height?: number }) {
  const pos = nodes.map((_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(nodes.length, 1);
    // Wider than tall: side nodes sit clear of the orchestrator at any panel width.
    return { x: 50 + 39 * Math.cos(angle), y: 50 + 39 * Math.sin(angle) };
  });
  return (
    <div>
      <div className="relative w-full" style={{ height }}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {nodes.map((n, i) => (
            <line key={n.type} x1="50" y1="50" x2={pos[i].x} y2={pos[i].y} stroke={NODE[n.status].line} strokeWidth="0.45" strokeDasharray={NODE[n.status].dash} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.5 }} />
          ))}
        </svg>
        <div className="absolute left-1/2 top-1/2 flex h-[112px] w-[112px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-rail-bg text-center text-white shadow-lift ring-8 ring-mint-light">
          <span aria-hidden className="text-[18px]">✦</span>
          <span className="mt-0.5 text-[14px] font-semibold">Orchestrator</span>
          <span className="text-[11px] text-rail-muted">Planner · Router</span>
        </div>
        {nodes.map((n, i) => (
          <Link
            key={n.type}
            href={hrefFor(n)}
            scroll={false}
            aria-label={`${agentWord(n.type)} — ${n.status}${n.tainted ? ", tainted" : ""}`}
            className={`absolute w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border px-3 py-2.5 shadow-card transition-shadow hover:shadow-lift ${NODE[n.status].ring} ${selected === n.type ? "ring-2 ring-brand" : ""}`}
            style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${NODE[n.status].dot}`} />
              <span className="truncate text-[13px] font-semibold text-ink">{agentWord(n.type)}</span>
              {n.tainted && <span title="Read untrusted third-party input — its writes need approval" className="ml-auto text-trust-risk"><AlertIcon size={14} /></span>}
            </span>
            <span className="mt-0.5 block truncate pl-[18px] text-[11px] text-body">{n.latestTask ? n.latestTask.title : n.tasks === 0 ? "Idle — no task in this mission" : ""}</span>
          </Link>
        ))}
      </div>
      <Legend />
    </div>
  );
}

export function Legend() {
  const items: [string, string][] = [["bg-status-run", "Running"], ["bg-status-idle", "Idle"], ["bg-ochre", "Blocked"], ["bg-forest", "Done"], ["bg-trust-risk-fill", "Failed"]];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-body">
      {items.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} />{l}</span>)}
      <span className="inline-flex items-center gap-1.5 text-trust-risk"><AlertIcon size={13} /><span className="text-body">Tainted</span></span>
    </div>
  );
}

// ─── tasks ──────────────────────────────────────────────────────────────────

export function TaskMarkers({ task }: { task: TaskView }) {
  return (
    <>
      {task.pendingApproval && <Marker tone="approval">Approval Required</Marker>}
      {task.dryRunRecorded && <Marker tone="dry" title="An approved outbound action was recorded, not sent — channels aren't connected">Dry-run · Not sent</Marker>}
      {task.tainted && <Marker tone="tainted" title="Read untrusted third-party content">Tainted</Marker>}
    </>
  );
}

export function TaskCard({ task, href, selected }: { task: TaskView; href: string; selected?: boolean }) {
  const last = task.runs.at(-1);
  return (
    <Link href={href} scroll={false} className={`block rounded-[12px] border bg-surface px-4 py-3 transition-shadow hover:shadow-card ${selected ? "border-brand ring-1 ring-brand" : "border-line"}`}>
      <p className="text-[14px] font-medium leading-snug text-ink">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-body">{agentWord(task.agentType)}</span>
        <StatusPill status={task.status} />
        <TaskMarkers task={task} />
        <span className="ml-auto text-[11px] text-muted">{ago(last?.updatedAt ?? task.updatedAt)}</span>
      </div>
      {!task.agentType && task.note && <p className="mt-1.5 text-[12px] text-trust-caution">{task.note}</p>}
    </Link>
  );
}

// ─── live steps ─────────────────────────────────────────────────────────────

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" });

function stepLine(s: RunStep): { level: "info" | "tool" | "warn" | "error"; text: string } {
  if (s.kind === "tool") {
    if (s.outcome === "approval") return { level: "warn", text: `${s.tool} → awaiting human approval before it can run` };
    if (s.outcome === "denied" || s.outcome === "error") return { level: "error", text: `${s.tool} → ${s.outcome}: ${s.observation ?? ""}` };
    return { level: "tool", text: `${s.tool}${s.ms !== undefined ? ` (${s.ms} ms)` : ""} → ${s.observation ?? "ok"}` };
  }
  if (s.kind === "finish") return { level: "info", text: `finished: ${s.observation ?? ""}` };
  if (s.kind === "spawn") return { level: "info", text: `spawned sub-tasks: ${s.observation ?? ""}` };
  if (s.kind === "blocked") return { level: "warn", text: `blocked: ${s.observation ?? ""}` };
  return { level: "info", text: s.observation ?? "" };
}

const LEVEL: Record<string, string> = { info: "text-[#8fd3ae]", tool: "text-[#9fc2ff]", warn: "text-[#f2c46b]", error: "text-[#ff9a8f]" };

/** The run log of a task's sub-agent runs, oldest first — straight from subagent_runs.steps. */
export function StepLog({ runs, task }: { runs: SubagentRun[]; task: TaskView }) {
  const lines: { at: string; level: string; text: string }[] = [];
  for (const r of runs) {
    lines.push({ at: r.startedAt, level: "info", text: `${agentWord(r.agentType)} took "${task.title}"${r.tainted ? " (tainted input)" : ""}` });
    for (const s of r.steps) lines.push({ at: s.at, ...stepLine(s) });
    if (r.stopReason && r.stopReason !== "awaiting_approval") lines.push({ at: r.updatedAt, level: r.status === "failed" ? "error" : "info", text: `run ${r.status} (${r.stopReason.replace(/_/g, " ")})` });
  }
  return (
    <div className="max-h-[340px] overflow-auto rounded-[10px] bg-console p-4 font-mono text-[12px] leading-[1.65] text-console-ink" aria-live="polite">
      {lines.length === 0 ? (
        <p className="text-console-ink/70">{task.status === "todo" ? "Waiting to start — runs when its dependencies are done." : task.agentType ? "No steps yet." : "No sub-agent can take this task yet."}</p>
      ) : (
        lines.map((l, i) => (
          <p key={i} className="grid grid-cols-[64px_52px_1fr] gap-2">
            <span className="text-console-ink/55">{clock(l.at)}</span>
            <span className={LEVEL[l.level]}>[{l.level}]</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{l.text.length > 400 ? `${l.text.slice(0, 400)}…` : l.text}</span>
          </p>
        ))
      )}
    </div>
  );
}

// ─── banners ────────────────────────────────────────────────────────────────

export function ApprovalBanner({ href }: { href: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-ochre/40 bg-trust-caution-bg px-4 py-3">
      <span className="text-ochre"><ShieldIcon size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">Approval Required</p>
        <p className="text-[12px] text-body">Outbound content must be approved by a human.</p>
      </div>
      <Link href={href} className="inline-flex h-8 items-center gap-1 rounded-control border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:border-ink/60">Review <ArrowRightIcon size={14} /></Link>
    </div>
  );
}

export function DryRunBanner() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-status-dry/25 bg-status-dry-bg px-4 py-3">
      <span aria-hidden className="text-[16px] text-status-dry">◇</span>
      <div>
        <p className="text-[13px] font-semibold text-ink">Dry-run Mode</p>
        <p className="text-[12px] text-body">Channels not connected. Approved sends and posts are recorded, not sent (sent:false).</p>
      </div>
    </div>
  );
}

export function TaintBanner() {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-rust/30 bg-trust-risk-bg px-4 py-3">
      <span className="text-trust-risk"><AlertIcon size={18} /></span>
      <p className="text-[12px] text-body"><span className="font-semibold text-ink">Untrusted input.</span> This task read third-party content, so every write it proposes waits for approval.</p>
    </div>
  );
}

// ─── the ship preview ───────────────────────────────────────────────────────

/** Exactly what would go out: the copy (RERA line highlighted), its AI label, the outbound kind, and why it stopped. */
export function ShipPreview({ approval }: { approval: Approval }) {
  return (
    <div className="space-y-2.5">
      <ul className="space-y-1">
        {approval.reasons.map((r) => (
          <li key={r} className="flex items-start gap-1.5 text-[12px] text-body"><span className="mt-0.5 text-ochre"><ShieldIcon size={13} /></span>{r}</li>
        ))}
      </ul>
      {approval.ships.length === 0 ? (
        <p className="rounded-[10px] bg-surface-alt px-3 py-2 text-[12px] text-muted">Nothing is shipped by this action (an internal step).</p>
      ) : (
        approval.ships.map((s, i) => (
          <div key={i} className="overflow-hidden rounded-[10px] border border-line">
            <div className="whitespace-pre-wrap bg-surface-alt/60 px-3.5 py-3 text-[13px] leading-relaxed text-ink">
              {/* Merge fields read as words ("[First name]") — never raw {{fields}} on a screen. */}
              {toFriendly(s.text).split("\n").map((line, j) => (
                <span key={j} className={`block ${/^RERA Reg\. No\.:/.test(line) ? "mt-1 font-semibold text-brand" : ""}`}>{line || " "}</span>
              ))}
              {/\{\{/.test(s.text) && <span className="mt-1.5 block text-[11px] text-muted">Words in [brackets] are filled in for each buyer when the message is sent.</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface px-3 py-2">
              <Marker tone={s.aiAssisted ? "dry" : "neutral"}>{s.aiLabel ?? (s.aiAssisted ? "AI label missing" : "Not AI-generated")}</Marker>
              <Marker tone="neutral">RERA {s.reraRegNo}</Marker>
              {approval.outbound && <Marker tone="approval">Outbound · {OUTBOUND_WORD[approval.outbound] ?? approval.outbound}</Marker>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
