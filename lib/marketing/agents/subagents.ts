import "server-only";
import { ARCHETYPES, type Archetype } from "../../premium/marketing-contract";
import type { Decision, PolicyState, RunStep, SubAgentType, TaskSpec } from "../harness/types";
import { resolveProjectKey } from "./grounding";
import { workspaceLeads } from "./catalogue";
import { draftsFor, humanSequences, KINDS, sequenceStepText } from "./tools";

/**
 * THE FOUR MARKETING SUB-AGENT TYPES — content, funnel, distribution,
 * analytics. Each has a DETERMINISTIC POLICY: it reads what its task asks
 * for (the task's own title + input — not the whole goal, so "launch" in the
 * goal doesn't turn every task into a send), then calls its tools in order,
 * chaining results (a publish uses the draft just made). The model does the
 * WRITING (inside content.generate etc., through lib/llm); the policy does
 * the sequencing — reproducible, and replayable after an approval pause.
 *
 * Scopes are the boundary: content and funnel-drafting can't reach an
 * outbound tool (no outbound:* scope / not in their tools). Only funnel
 * (landing go-live) and distribution (publish, email, sequence step) hold an
 * outbound scope — and every outbound call is approval-gated by the spine.
 */

// ─── a replayable scripted policy ───────────────────────────────────────────

interface Call {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

/** One executed tool step, with its outcome after any approval. */
interface Out {
  tool: string;
  outcome: "executed" | "approved" | "declined" | "denied" | "error";
  result: Record<string, unknown> | null;
  observation: string;
}

const parse = (text: string | undefined): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text ?? "");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Tool steps → outcomes; an approval step takes the outcome of the observation the resume appended. */
function outputsOf(steps: RunStep[]): Out[] {
  const outs: Out[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== "tool" || !s.tool) return;
    if (s.outcome === "approval") {
      const next = steps[i + 1];
      if (!next || next.kind !== "observation") return; // still waiting
      const text = next.observation ?? "";
      const ran = /approved .*?; it ran: ([\s\S]*)$/.exec(text);
      outs.push(ran ? { tool: s.tool, outcome: "approved", result: parse(ran[1]), observation: text } : / declined /.test(text) ? { tool: s.tool, outcome: "declined", result: null, observation: text } : { tool: s.tool, outcome: "error", result: null, observation: text });
      return;
    }
    outs.push({ tool: s.tool, outcome: s.outcome === "executed" ? "executed" : s.outcome === "denied" ? "denied" : "error", result: parse(s.observation), observation: s.observation ?? "" });
  });
  return outs;
}

type Group = (s: PolicyState, outs: Out[]) => Promise<Call[]>;

function scripted(groups: (s: PolicyState) => Group[], finish: (s: PolicyState, outs: Out[]) => Promise<{ summary: string; output: unknown }>) {
  return async (s: PolicyState): Promise<Decision> => {
    const outs = outputsOf(s.steps);
    const last = outs.at(-1);
    if (last && (last.outcome === "denied" || last.outcome === "error")) return { kind: "blocked", reason: `${last.tool}: ${last.observation.slice(0, 300)}` };
    try {
      let planned = 0;
      for (const group of groups(s)) {
        const calls = await group(s, outs.slice(0, planned));
        if (planned + calls.length > outs.length) {
          const c = calls[outs.length - planned];
          return { kind: "tool", tool: c.tool, args: c.args, thought: c.why };
        }
        planned += calls.length;
      }
      return { kind: "finish", ...(await finish(s, outs)) };
    } catch (error) {
      // A missing prerequisite (no project, no drafts yet) is a BLOCKED task with its reason, not a crash.
      return { kind: "blocked", reason: error instanceof Error ? error.message : "cannot continue" };
    }
  };
}

const taskText = (s: PolicyState) => `${s.task.title} ${JSON.stringify(s.task.input ?? {})}`;
const has = (re: RegExp, s: PolicyState) => re.test(taskText(s));
const once = (call: Call | null): Group => async () => (call ? [call] : []);
const lazy = (make: (s: PolicyState, outs: Out[]) => Promise<Call | Call[] | null>): Group => async (s, outs) => {
  const c = await make(s, outs);
  return c === null ? [] : Array.isArray(c) ? c : [c];
};
const resultOf = (outs: Out[], tool: string) => outs.filter((o) => o.tool === tool && o.result).at(-1)?.result ?? null;
const tally = (outs: Out[]) => ({ approved: outs.filter((o) => o.outcome === "approved").length, declined: outs.filter((o) => o.outcome === "declined").length });

async function projectKeyFor(s: PolicyState): Promise<string | null> {
  return resolveProjectKey(s, `${s.task.title} ${s.goal.text}`, s.task.input?.projectKey);
}

const needProject: Group = async (s) =>
  (await projectKeyFor(s))
    ? []
    : Promise.reject(new Error(s.workspace.builderId ? `No building of ${s.workspace.builderId} in the premium inventory matches this task — name one of its buildings.` : "This workspace isn't linked to a builder in the premium inventory yet (Agent Harness → Settings), so it has no buildings to work on."));

/** The archetype a task / goal is about: explicit, an audience in memory that names one, or the words in the goal. */
async function archetypeFor(s: PolicyState): Promise<Archetype> {
  const explicit = s.task.input?.archetype;
  if (typeof explicit === "string" && (ARCHETYPES as readonly string[]).includes(explicit)) return explicit as Archetype;
  const text = `${s.task.title} ${s.goal.text}`;
  for (const a of await s.memory.retrieve(text, { kinds: ["audience"], limit: 3 })) {
    const v = a.item.data.archetype;
    if (typeof v === "string" && (ARCHETYPES as readonly string[]).includes(v)) return v as Archetype;
  }
  if (/\bNRI|abroad|overseas|non[- ]resident/i.test(text)) return "nri";
  if (/investor|rental|yield/i.test(text)) return "investor";
  if (/first[- ]time|first home/i.test(text)) return "first_time";
  if (/upgrad/i.test(text)) return "upgrader";
  return "end_user_family";
}

// ─── content ────────────────────────────────────────────────────────────────

export const contentAgent: SubAgentType = {
  type: "content",
  description:
    "Drafts marketing copy from the project's verified facts: social posts, captions, ad copy (content.generate) and SEO + landing copy — title tag, meta description, H1 (content.seoCopy). Every draft carries the RERA line and an AI label. Drafts only; it can never publish or send.",
  tools: ["brandkit.get", "content.generate", "content.seoCopy"],
  scopes: ["memory:read", "content:write"],
  plan: (goal) => [{ title: "Draft social posts, captions and ad copy", agentType: "content" }, ...(/seo|website|landing|search/i.test(goal) ? [{ title: "Draft SEO + landing copy", agentType: "content" }] : [])],
  decide: scripted(
    (s) => {
      const seoOnly = has(/\bseo\b|meta|title tag|search|website copy|landing copy/i, s) && !has(/post|caption|ad\b|ads\b|social|creative/i, s);
      const wantsSeo = has(/\bseo\b|meta|title tag|search|website|landing/i, s);
      return [
        needProject,
        once({ tool: "brandkit.get", args: {}, why: "read the brand's tone and RERA number" }),
        lazy(async (st) => (seoOnly ? null : { tool: "content.generate", args: { projectKey: (await projectKeyFor(st))!, ...(Array.isArray(st.task.input?.types) ? { types: st.task.input.types } : {}) }, why: "draft posts, captions and ad copy from the facts" })),
        lazy(async (st) => (wantsSeo ? { tool: "content.seoCopy", args: { projectKey: (await projectKeyFor(st))! }, why: "draft SEO + landing copy" } : null)),
      ];
    },
    async (s, outs) => {
      const ids = [...((resultOf(outs, "content.generate")?.draftIds as string[]) ?? []), ...(resultOf(outs, "content.seoCopy")?.draftId ? [String(resultOf(outs, "content.seoCopy")!.draftId)] : [])];
      const drafts = (await Promise.all(ids.map((id) => s.memory.get(KINDS.draft, id)))).filter(Boolean).map((d) => ({ id: d!.key, type: d!.data.type, channel: d!.data.channel, title: d!.title, body: d!.data.body, aiLabel: d!.data.aiLabel, reraRegNo: d!.data.reraRegNo, engine: d!.data.engine, fallbackReason: d!.data.fallbackReason ?? null }));
      return { summary: `${drafts.length} draft${drafts.length === 1 ? "" : "s"} ready (${drafts.map((d) => d.type).join(", ")}) — not published`, output: { drafts } };
    },
  ),
};

// ─── funnel ─────────────────────────────────────────────────────────────────

export const funnelAgent: SubAgentType = {
  type: "funnel",
  description:
    "The capture funnel: drafts the project landing page (landing.draft), configures the archetype quiz with routing + tagging (funnel.quizConfigure), assembles per-archetype nurture sequences from the HUMAN-WRITTEN messages (sequence.build), and can put a drafted landing page live (landing.publish — needs operator approval).",
  tools: ["brandkit.get", "landing.draft", "landing.publish", "funnel.quizConfigure", "sequence.build"],
  scopes: ["memory:read", "funnel:write", "outbound:go_live"],
  plan: (goal) => {
    const tasks: TaskSpec[] = [{ title: "Draft the landing page", agentType: "funnel" }];
    if (/nurture|sequence|quiz|archetype|segment|NRI|investor|first[- ]time|family|upgrad/i.test(goal)) tasks.push({ title: "Configure the archetype quiz and routing", agentType: "funnel" }, { title: "Build the nurture sequences from the approved messages", agentType: "funnel" });
    if (/publish|go live|launch|send/i.test(goal)) tasks.push({ title: "Publish the landing page", agentType: "funnel", dependsOn: [0] });
    return tasks;
  },
  decide: scripted(
    (s) => {
      const publish = has(/publish|go live|make .*live|put .*live/i, s);
      const quiz = has(/quiz|archetype|question|routing|tagging|persona/i, s);
      const seq = has(/sequence|nurture|follow[- ]?up|drip/i, s);
      const landing = publish || has(/landing|page/i, s) || (!quiz && !seq);
      return [
        landing ? needProject : once(null),
        lazy(async (st) => {
          if (!landing) return null;
          // Publishing reuses this goal's landing draft when there is one.
          if (publish && (await st.memory.list(KINDS.landing)).some((l) => l.data.goalId === st.goal.id)) return null;
          return { tool: "landing.draft", args: { projectKey: (await projectKeyFor(st))! }, why: "draft the landing page from the project's facts" };
        }),
        once(quiz ? { tool: "funnel.quizConfigure", args: {}, why: "configure the archetype quiz, routing and tags" } : null),
        once(seq || quiz ? { tool: "sequence.build", args: {}, why: "assemble the human-written nurture sequences per archetype" } : null),
        lazy(async (st, outs) => {
          if (!publish) return null;
          const made = resultOf(outs, "landing.draft");
          const id = made ? String(made.landingId) : (await st.memory.list(KINDS.landing)).filter((l) => l.data.goalId === st.goal.id).at(-1)?.key;
          const d = id ? await st.memory.get(KINDS.landing, id) : null;
          if (!d) return Promise.reject(new Error("No landing page draft to publish."));
          return { tool: "landing.publish", args: { landingId: d.key, slug: d.data.slug, headline: d.data.headline, subhead: d.data.subhead ?? null, reraRegNo: d.data.reraRegNo, aiLabel: d.data.aiLabel }, why: "put the landing page live (needs approval)" };
        }),
      ];
    },
    async (_s, outs) => {
      const parts = [resultOf(outs, "landing.draft") && `landing page /${resultOf(outs, "landing.draft")!.slug} drafted`, resultOf(outs, "funnel.quizConfigure") && "quiz configured", resultOf(outs, "sequence.build") && `${(resultOf(outs, "sequence.build")!.sequences as unknown[]).length} human-written sequences assembled`, outs.some((o) => o.tool === "landing.publish") && `go-live ${outs.find((o) => o.tool === "landing.publish")!.outcome}`].filter(Boolean);
      return { summary: parts.join("; ") || "nothing to do", output: { landing: resultOf(outs, "landing.draft"), quiz: resultOf(outs, "funnel.quizConfigure"), sequences: resultOf(outs, "sequence.build"), publish: outs.find((o) => o.tool === "landing.publish")?.result ?? null, ...tally(outs) } };
    },
  ),
};

// ─── distribution ───────────────────────────────────────────────────────────

const SOCIAL = new Set(["instagram", "facebook", "linkedin", "youtube"]);

export const distributionAgent: SubAgentType = {
  type: "distribution",
  description:
    "Gets drafted content out: plans the social calendar (distribution.planCalendar — no approval), and — each needing operator approval — publishes scheduled posts (distribution.publishPost), sends the launch email (email.send) and sends nurture sequence steps (sequence.sendStep). Works on drafts the content sub-agent already made; channels are dry-run for now.",
  tools: ["brandkit.get", "distribution.planCalendar", "distribution.publishPost", "email.send", "sequence.sendStep"],
  scopes: ["memory:read", "distribution:write", "outbound:publish", "outbound:send"],
  // Publishes what content drafted; doesn't need funnel (and must not wait on its approval-gated go-live).
  after: ["content"],
  plan: (goal) => {
    const tasks: TaskSpec[] = [{ title: "Plan the social calendar", agentType: "distribution" }];
    if (/publish|launch|send|post|distribut/i.test(goal)) tasks.push({ title: "Publish the scheduled social posts", agentType: "distribution", dependsOn: [0] });
    if (/email|send|launch/i.test(goal)) tasks.push({ title: "Send the launch email", agentType: "distribution" });
    return tasks;
  },
  decide: scripted(
    (s) => {
      // Publishing needs a publishing VERB — "Plan the social calendar" is a plan, not a post.
      const social = has(/\b(publish|go live|post (the|them|it|to)|share (the|them|it) on)\b/i, s);
      const email = has(/e-?mail|newsletter|mail/i, s);
      const seq = has(/sequence|nurture|follow[- ]?up|drip/i, s);
      const planning = has(/calendar|schedule|plan|cadence|timeline/i, s);
      const calendar = planning || social || (!email && !seq);
      // "Send / distribute the campaign" with no channel named → posts + email. A task that asks for a PLAN only plans,
      // even when the goal's words ("launch campaign") appear in its title.
      const genericSend = !planning && !social && !email && !seq && has(/\bsend\b|distribut/i, s);
      return [
        lazy(async (st) => {
          if (!(calendar || genericSend)) return null;
          if (social && (await st.memory.list(KINDS.calendar)).some((c) => c.data.goalId === st.goal.id)) return null; // reuse this goal's calendar
          return { tool: "distribution.planCalendar", args: {}, why: "slot this goal's drafts on the calendar" };
        }),
        lazy(async (st, outs) => {
          if (!(social || genericSend)) return null;
          const calId = resultOf(outs, "distribution.planCalendar")?.calendarId ?? (await st.memory.list(KINDS.calendar)).filter((c) => c.data.goalId === st.goal.id).at(-1)?.key;
          const cal = calId ? await st.memory.get(KINDS.calendar, String(calId)) : null;
          const slots = (cal?.data.slots as { draftId: string; channel: string; at: string }[] | undefined) ?? [];
          const calls: Call[] = [];
          for (const slot of slots.filter((x) => SOCIAL.has(x.channel))) {
            const d = await st.memory.get(KINDS.draft, slot.draftId);
            if (d) calls.push({ tool: "distribution.publishPost", args: { draftId: d.key, channel: slot.channel, text: d.data.body, reraRegNo: d.data.reraRegNo, aiLabel: d.data.aiLabel, scheduledAt: slot.at }, why: `publish the ${d.data.type} on ${slot.channel} (needs approval)` });
          }
          return calls;
        }),
        lazy(async (st) => {
          if (!(email || genericSend)) return null;
          const d = (await draftsFor({ memory: st.memory, goalId: st.goal.id })).find((x) => x.data.type === "social_post") ?? (await draftsFor({ memory: st.memory, goalId: st.goal.id }))[0];
          if (!d) return Promise.reject(new Error("No drafted copy for this goal yet — the content sub-agent drafts it first."));
          const audience = (await st.memory.retrieve(`${st.task.title} ${st.goal.text}`, { kinds: ["audience"], limit: 1 }))[0]?.item.key;
          return { tool: "email.send", args: { draftId: d.key, subject: d.title, text: d.data.body, reraRegNo: d.data.reraRegNo, aiLabel: d.data.aiLabel, ...(audience ? { audienceKey: audience } : {}) }, why: "email the launch copy to the audience (needs approval)" };
        }),
        lazy(async (st) => {
          if (!seq) return null;
          const archetype = await archetypeFor(st);
          const s0 = (await humanSequences({ workspace: st.workspace })).find((x) => x.params.archetype === archetype);
          const rera = (await st.memory.get("brand_kit", "main"))?.data.defaultReraRegNo ?? (await draftsFor({ memory: st.memory, goalId: st.goal.id }))[0]?.data.reraRegNo;
          if (!s0 || typeof rera !== "string") return Promise.reject(new Error("Needs a nurture sequence and a RERA number (brand kit) first."));
          return { tool: "sequence.sendStep", args: { archetype, stepIndex: 0, text: sequenceStepText(s0.steps[0].template, rera), reraRegNo: rera }, why: `send the first ${archetype} nurture step, verbatim (needs approval)` };
        }),
      ];
    },
    async (_s, outs) => {
      const t = tally(outs);
      const planned = resultOf(outs, "distribution.planCalendar");
      return { summary: `${planned ? `${planned.slots} post(s) on the calendar; ` : ""}${t.approved} outbound approved (dry run), ${t.declined} declined`, output: { calendar: planned, outbound: outs.filter((o) => o.tool !== "distribution.planCalendar" && o.tool !== "brandkit.get").map((o) => ({ tool: o.tool, outcome: o.outcome, result: o.result })) } };
    },
  ),
};

// ─── analytics ──────────────────────────────────────────────────────────────

export const analyticsAgent: SubAgentType = {
  type: "analytics",
  description: "Read-only numbers: campaign performance and cost-per-booking attribution (analytics.report), lead scoring hot/warm/cold (lead.score) and buyer archetypes from quiz answers (lead.archetype) — deterministic, no model.",
  tools: ["analytics.report", "lead.score", "lead.archetype"],
  scopes: ["memory:read", "analytics:read"],
  plan: (goal) => (/report|performance|cost|booking|attribution|roi|score|lead/i.test(goal) ? [{ title: "Report campaign performance and cost per booking", agentType: "analytics" }] : []),
  decide: scripted(
    (s) => {
      const score = has(/score|priorit|hot|warm|cold/i, s);
      const arche = has(/archetype|classify|persona/i, s);
      const report = has(/report|performance|cost|booking|attribution|roi|dashboard/i, s) || (!score && !arche);
      return [
        once(report ? { tool: "analytics.report", args: {}, why: "pull campaign performance and cost per booking" } : null),
        // Leads come from the premium leads store (this builder's only) — never a local copy. A score carries the lead's archetype tag.
        lazy(async (st) => (score || arche ? (await workspaceLeads(st.workspace, 10)).map((l) => ({ tool: "lead.score", args: { leadId: l.id }, why: `score lead ${l.id}` })) : null)),
      ];
    },
    async (_s, outs) => ({
      summary: `${outs.filter((o) => o.tool === "analytics.report").length ? "report ready" : ""}${outs.filter((o) => o.tool === "lead.score").length ? `; ${outs.filter((o) => o.tool === "lead.score").length} leads scored` : ""}${outs.filter((o) => o.tool === "lead.archetype").length ? `; ${outs.filter((o) => o.tool === "lead.archetype").length} classified` : ""}`.replace(/^; /, "") || "nothing to report",
      output: { report: resultOf(outs, "analytics.report"), scores: outs.filter((o) => o.tool === "lead.score").map((o) => o.result), archetypes: outs.filter((o) => o.tool === "lead.archetype").map((o) => o.result) },
    }),
  ),
};

export const MARKETING_AGENT_TYPES: SubAgentType[] = [contentAgent, funnelAgent, distributionAgent, analyticsAgent];
