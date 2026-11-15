"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { AUTONOMY, executedWords } from "./words";

/**
 * CONSOLE CONTROLS — every action calls the EXISTING harness API
 * (/api/marketing/*): the same auth, workspace-membership check and approval
 * gate as any other caller. Nothing here decides anything; it asks and shows
 * the answer.
 */

type Msg = { ok: boolean; text: string } | null;

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(`/api/marketing${path}`, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as T & { error?: string };
    return r.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Failed (${r.status})` };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

function useAction() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Msg>) =>
    start(async () => {
      const m = await fn();
      setMsg(m);
      router.refresh();
    });
  return { msg, pending, run, router };
}

const Note = ({ msg }: { msg: Msg }) => (msg ? <p role="status" className={`text-[12px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p> : null);
const enc = encodeURIComponent;

// ─── workspace: on/off + autonomy ───────────────────────────────────────────

export function WorkspaceToggle({ workspaceId, enabled, label = true }: { workspaceId: string; enabled: boolean; label?: boolean }) {
  const { pending, run, msg } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Switch the harness off" : "Switch the harness on"}
        disabled={pending}
        onClick={() => run(async () => {
          const r = await api("PATCH", `/workspaces/${enc(workspaceId)}`, { enabled: !enabled });
          return r.ok ? null : { ok: false, text: r.error };
        })}
        className={`relative h-[22px] w-[40px] rounded-full transition-colors ${enabled ? "bg-brand" : "bg-line-strong"} disabled:opacity-50`}
      >
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? "left-[21px]" : "left-[3px]"}`} />
      </button>
      {label && <span className="text-[13px] text-ink">{enabled ? "On" : "Off"}</span>}
      <Note msg={msg} />
    </span>
  );
}

/** Automatic first replies to new leads (low-risk types only). Off by default. */
export function AutoFirstReplyToggle({ workspaceId, on }: { workspaceId: string; on: boolean }) {
  const { pending, run, msg } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? "Turn automatic first replies off" : "Turn automatic first replies on"}
        disabled={pending}
        onClick={() => run(async () => {
          const r = await api("PATCH", `/workspaces/${enc(workspaceId)}`, { autoFirstReply: !on });
          return r.ok ? null : { ok: false, text: r.error };
        })}
        className={`relative h-[22px] w-[40px] rounded-full transition-colors ${on ? "bg-brand" : "bg-line-strong"} disabled:opacity-50`}
      >
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
      </button>
      <span className="text-[13px] text-ink">{on ? "On" : "Off"}</span>
      <Note msg={msg} />
    </span>
  );
}

export function AutonomyControl({ workspaceId, autonomy }: { workspaceId: string; autonomy: string }) {
  const { pending, run, msg } = useAction();
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Autonomy level" className="grid gap-2 sm:grid-cols-3">
        {AUTONOMY.map((a) => (
          <button
            key={a.value}
            type="button"
            role="radio"
            aria-checked={autonomy === a.value}
            disabled={pending}
            onClick={() => run(async () => {
              const r = await api("PATCH", `/workspaces/${enc(workspaceId)}`, { autonomy: a.value });
              return r.ok ? { ok: true, text: `Autonomy set to ${a.label}. Outbound actions still need approval.` } : { ok: false, text: r.error };
            })}
            className={`rounded-[10px] border px-3.5 py-3 text-left transition-colors ${autonomy === a.value ? "border-brand bg-mint-light ring-1 ring-brand" : "border-line bg-surface hover:border-line-strong"}`}
          >
            <span className="block text-[14px] font-semibold text-ink">{a.label}</span>
            <span className="mt-1 block text-[12px] leading-snug text-body">{a.help}</span>
          </button>
        ))}
      </div>
      <Note msg={msg} />
    </div>
  );
}

// ─── creating things ────────────────────────────────────────────────────────

export function NewWorkspace() {
  const { pending, run, msg } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>+ New workspace</Button>;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api("POST", "/workspaces", { name });
          if (!r.ok) return { ok: false, text: r.error };
          setName("");
          setOpen(false);
          return { ok: true, text: "Workspace created — it starts OFF and suggest-only." };
        });
      }}
    >
      <input className="control h-9 w-56" autoFocus required maxLength={120} placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" disabled={pending || !name.trim()}>Create</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
      <Note msg={msg} />
    </form>
  );
}

export function NewMission({ workspaces, defaultWorkspace, defaultText = "" }: { workspaces: { id: string; name: string; enabled: boolean }[]; defaultWorkspace?: string; defaultText?: string }) {
  const { pending, run, msg, router } = useAction();
  const [ws, setWs] = useState(defaultWorkspace ?? workspaces[0]?.id ?? "");
  const [text, setText] = useState(defaultText);
  const off = workspaces.find((w) => w.id === ws)?.enabled === false;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api<{ goal: { id: string } }>("POST", `/workspaces/${enc(ws)}/goals`, { text });
          if (!r.ok) return { ok: false, text: r.error };
          setText("");
          router.push(`/marketing/harness/missions/${enc(ws)}/${enc(r.data.goal.id)}`);
          return { ok: true, text: "Planned — opening the mission." };
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <select className="control h-10 w-52" aria-label="Workspace" value={ws} onChange={(e) => setWs(e.target.value)}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}{w.enabled ? "" : " (off)"}</option>)}
        </select>
        <input className="control h-10 min-w-[280px] flex-1" required minLength={3} maxLength={2000} placeholder="Give the agents a goal — e.g. Plan and send a launch campaign for Project X targeting NRI investors" value={text} onChange={(e) => setText(e.target.value)} />
        <Button size="sm" className="h-10" disabled={pending || !ws || text.trim().length < 3}>{pending ? "Planning…" : "Start mission"}</Button>
      </div>
      {off && <p className="text-[12px] text-trust-caution">This workspace is switched off — turn it on (Settings) before starting a mission.</p>}
      <Note msg={msg} />
    </form>
  );
}

// ─── missions ───────────────────────────────────────────────────────────────

export function GoalActions({ workspaceId, goalId, status }: { workspaceId: string; goalId: string; status: string }) {
  const { pending, run, msg } = useAction();
  const post = (action: "run" | "cancel") =>
    run(async () => {
      const r = await api("POST", `/workspaces/${enc(workspaceId)}/goals/${enc(goalId)}`, { action });
      return r.ok ? { ok: true, text: action === "run" ? "Running." : "Cancelled — pending approvals expired." } : { ok: false, text: r.error };
    });
  const active = ["planning", "planned", "running", "blocked"].includes(status);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {/* Only a plan-only mission waits for "Run"; a blocked one is waiting on approvals, not on this button. */}
        {status === "planned" && <Button size="sm" disabled={pending} onClick={() => post("run")}>Run</Button>}
        {active && <Button size="sm" variant="secondary" disabled={pending} onClick={() => { if (confirm("Cancel this mission? Pending approvals will expire.")) post("cancel"); }}>Cancel mission</Button>}
      </div>
      <Note msg={msg} />
    </div>
  );
}

// ─── approvals ──────────────────────────────────────────────────────────────

export function ApprovalActions({ workspaceId, approvalId, compact = false }: { workspaceId: string; approvalId: string; compact?: boolean }) {
  const { pending, run, msg } = useAction();
  const [note, setNote] = useState("");
  const decide = (decision: "approve" | "decline") =>
    run(async () => {
      const r = await api<{ executed: { ok: boolean; observation: string } | null }>("POST", `/workspaces/${enc(workspaceId)}/approvals/${enc(approvalId)}`, { decision, note: note.trim() || null });
      return r.ok ? executedWords(r.data.executed) : { ok: false, text: r.error };
    });
  if (msg?.ok) return <Note msg={msg} />;
  return (
    <div className="space-y-2">
      {!compact && <input className="control h-9 w-full" placeholder="Note (optional)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide("approve")}>Approve</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => decide("decline")}>Decline</Button>
      </div>
      <Note msg={msg} />
    </div>
  );
}

// ─── automations ────────────────────────────────────────────────────────────

export function ScheduleActions({ workspaceId, scheduleId, status }: { workspaceId: string; scheduleId: string; status: string }) {
  const { pending, run, msg } = useAction();
  const act = (action: "pause" | "resume" | "run-now") =>
    run(async () => {
      const r = await api<{ goalId?: string }>("PATCH", `/workspaces/${enc(workspaceId)}/schedules/${enc(scheduleId)}`, { action });
      if (!r.ok) return { ok: false, text: r.error };
      return { ok: true, text: action === "run-now" ? "Fired — a mission was submitted (outbound steps wait for approval)." : action === "pause" ? "Paused." : "Resumed." };
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status === "active" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("pause")}>Pause</Button> : <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("resume")}>Resume</Button>}
        <Button size="sm" disabled={pending} onClick={() => act("run-now")}>Run now</Button>
      </div>
      <Note msg={msg} />
    </div>
  );
}

export function NewSchedule({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const { pending, run, msg } = useAction();
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"cron" | "event">("cron");
  const [when, setWhen] = useState("0 10 * * 1");
  const [goal, setGoal] = useState("");
  return (
    <form
      className="grid gap-2 md:grid-cols-[180px_1fr_120px_160px]"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api("POST", `/workspaces/${enc(ws)}/schedules`, { name, goal, trigger: kind === "cron" ? { kind, cron: when } : { kind, event: when } });
          if (!r.ok) return { ok: false, text: r.error };
          setName("");
          setGoal("");
          return { ok: true, text: "Schedule created." };
        });
      }}
    >
      <select className="control h-10" aria-label="Workspace" value={ws} onChange={(e) => setWs(e.target.value)}>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <input className="control h-10" required placeholder="Name — e.g. Weekly content refresh" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="control h-10" aria-label="Trigger" value={kind} onChange={(e) => { const k = e.target.value as "cron" | "event"; setKind(k); setWhen(k === "cron" ? "0 10 * * 1" : "lead.created"); }}>
        <option value="cron">On a schedule</option>
        <option value="event">On an event</option>
      </select>
      <input className="control h-10 font-mono text-[13px]" required aria-label={kind === "cron" ? "Cron" : "Event"} value={when} onChange={(e) => setWhen(e.target.value)} />
      <input className="control h-10 md:col-span-3" required minLength={3} placeholder="What the agents should do each time (the mission goal)" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <Button size="sm" className="h-10" disabled={pending || !ws}>Create schedule</Button>
      <div className="md:col-span-4"><Note msg={msg} /></div>
    </form>
  );
}

// ─── checkpoints ────────────────────────────────────────────────────────────

export function NewCheckpoint({ workspaceId }: { workspaceId: string }) {
  const { pending, run, msg } = useAction();
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState("workspace");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api("POST", `/workspaces/${enc(workspaceId)}/checkpoints`, { label, scope });
          if (!r.ok) return { ok: false, text: r.error };
          setLabel("");
          return { ok: true, text: "Checkpoint saved." };
        });
      }}
    >
      <input className="control h-9 w-56" required maxLength={160} placeholder="Label — e.g. before Diwali edits" value={label} onChange={(e) => setLabel(e.target.value)} />
      <select className="control h-9 w-48" aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}>
        <option value="workspace">Whole workspace</option>
        <option value="memory">Company memory</option>
        <option value="settings">Settings</option>
        <option value="schedules">Automations</option>
      </select>
      <Button size="sm" disabled={pending || !label.trim()}>Save checkpoint</Button>
      <Note msg={msg} />
    </form>
  );
}

export function RollbackButton({ workspaceId, checkpointId, label }: { workspaceId: string; checkpointId: string; label: string }) {
  const { pending, run, msg } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Roll back to "${label}"? The current state is checkpointed first, so this can be undone.`)) return;
          run(async () => {
            const r = await api("POST", `/workspaces/${enc(workspaceId)}/checkpoints/${enc(checkpointId)}`);
            return r.ok ? { ok: true, text: "Restored. An undo checkpoint was saved." } : { ok: false, text: r.error };
          });
        }}
      >
        Roll back
      </Button>
      <Note msg={msg} />
    </div>
  );
}

// ─── tool settings ──────────────────────────────────────────────────────────

export function ToolSettingControls({ workspaceId, tool, enabled, requiresApproval, ownApproval }: { workspaceId: string; tool: string; enabled: boolean; requiresApproval: boolean; ownApproval: boolean }) {
  const { pending, run, msg } = useAction();
  const set = (patch: { enabled?: boolean; forceApproval?: boolean }) =>
    run(async () => {
      const r = await api("PATCH", `/workspaces/${enc(workspaceId)}/tools`, { tool, ...patch });
      return r.ok ? null : { ok: false, text: r.error };
    });
  return (
    <div className="flex items-center justify-end gap-3 text-[13px]">
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
      </label>
      <label className="inline-flex items-center gap-1.5" title={ownApproval ? "This tool always asks first — it can't be loosened." : "Make this tool always ask first in this workspace."}>
        <input type="checkbox" checked={requiresApproval} disabled={pending || ownApproval} onChange={(e) => set({ forceApproval: e.target.checked })} /> Always ask
      </label>
      <Note msg={msg} />
    </div>
  );
}

// ─── deleting a workspace ───────────────────────────────────────────────────

export function DeleteWorkspace({ workspaceId, name, enabled }: { workspaceId: string; name: string; enabled: boolean }) {
  const { pending, run, msg, router } = useAction();
  const [typed, setTyped] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(`Delete "${name}" and everything in it — missions, approvals, audit trail, checkpoints, automations and company memory? This can't be undone.`)) return;
        run(async () => {
          const r = await api("DELETE", `/workspaces/${enc(workspaceId)}`, { confirm: typed });
          if (!r.ok) return { ok: false, text: r.error };
          router.push("/marketing/harness");
          return { ok: true, text: "Workspace deleted." };
        });
      }}
    >
      {enabled && <p className="text-[12px] text-trust-caution">Switch the workspace off first (above) — nothing may start while it is being deleted.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="control h-9 w-64" aria-label="Type the workspace name to confirm" placeholder={`Type “${name}” to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={enabled} />
        <button type="submit" disabled={pending || enabled || typed.trim() !== name} className="inline-flex h-9 items-center rounded-control bg-rust px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
          Delete workspace
        </button>
      </div>
      <Note msg={msg} />
    </form>
  );
}

/**
 * Link this workspace to ITS builder in the premium inventory (the builder named in its brand kit): the agents then
 * read that builder's buildings, units and leads live, and its project-page leads route here. One workspace per builder.
 */
export function SpineLink({ workspaceId, builderId, builder }: { workspaceId: string; builderId: string | null; builder: string | null }) {
  const { pending, run, msg } = useAction();
  const linked = Boolean(builderId);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant={linked ? "secondary" : "primary"}
        disabled={pending || (!linked && !builder)}
        title={!linked && !builder ? "Add the builder's name to the brand kit first" : undefined}
        onClick={() => run(async () => {
          const r = await api("PATCH", `/workspaces/${enc(workspaceId)}`, { builderId: linked ? null : builder });
          return r.ok ? { ok: true, text: linked ? "Unlinked — no buildings or leads are read for this workspace now." : `Linked to ${builder} — its buildings and leads are read from the premium inventory.` } : { ok: false, text: r.error };
        })}
      >
        {linked ? "Unlink" : builder ? `Link to ${builder}` : "Link to builder"}
      </Button>
      <Note msg={msg} />
    </div>
  );
}

/** On a project page: send this building's leads to one of my workspaces (archetype follow-ups, each approved). */
export function ConnectProject({ propertyId, workspaces }: { propertyId: string; workspaces: { id: string; name: string }[] }) {
  const { pending, run, msg } = useAction();
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  if (workspaces.length === 0) return <p className="text-[13px] text-body">Create a workspace in Agent Harness first.</p>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-ink">Send this page&apos;s leads to</span>
        <select className="control h-9 w-60" aria-label="Workspace" value={ws} onChange={(e) => setWs(e.target.value)}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <Button
          size="sm"
          disabled={pending || !ws}
          onClick={() => run(async () => {
            const r = await api<{ enrolled: number }>("POST", `/workspaces/${enc(ws)}/projects`, { propertyId, action: "add" });
            return r.ok ? { ok: true, text: `Connected.${r.data.enrolled ? ` ${r.data.enrolled} earlier lead${r.data.enrolled === 1 ? " was" : "s were"} enrolled — their first messages are waiting for approval.` : ""}` } : { ok: false, text: r.error };
          })}
        >
          Connect
        </Button>
      </div>
      <Note msg={msg} />
    </div>
  );
}

export function DisconnectProject({ workspaceId, propertyId }: { workspaceId: string; propertyId: string }) {
  const { pending, run, msg } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!confirm("Stop sending this page's leads to the workspace? Leads already enrolled keep their follow-ups.")) return;
          run(async () => {
            const r = await api("POST", `/workspaces/${enc(workspaceId)}/projects`, { propertyId, action: "remove" });
            return r.ok ? { ok: true, text: "Disconnected." } : { ok: false, text: r.error };
          });
        }}
      >
        Disconnect
      </Button>
      <Note msg={msg} />
    </span>
  );
}
