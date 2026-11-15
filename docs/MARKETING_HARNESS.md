# Marketing agentic harness

The marketing engine's own agentic harness. It works at **company / operator level**: one system runs marketing for a whole company's inventory, campaigns and leads, inside a **workspace**. Compare the concierge, which is per person. The **spine** holds no features. Features plug in as **tools** and **sub-agent types** through the seams below; M1–M3 are registered (see "Registered features").

Code: `lib/marketing/harness/` · API: `/api/marketing/*` · DB: `supabase/migrations/0006_marketing_harness.sql` · Check: `npm run verify:harness`

## Modules

Each module is separate and can be replaced on its own:

| # | Module | Owns |
|---|---|---|
| 1 | `runtime.ts` | One sub-agent run: plan → act (a tool call, through the gate) → observe → repeat. Stop conditions: finished, spawned, blocked, awaiting approval, `max_steps`, `budget_tool_calls`, `budget_time`, `repeated_action`, `error_streak`, harness off, cancelled. Runs are persisted, so a run survives a pause for approval. |
| 2 | `memory.ts` | Company memory for one workspace: brand kit, projects, audiences, campaigns, leads, plus append-only decisions and learnings. Retrieval is lexical BM25 by default (`setRetriever` replaces it). |
| 3 | `orchestrator.ts` | Goal intake → planner → tasks → one sub-agent per task, **spawned on demand** → parallel waves over the dependency graph → join. Also holds the **sub-agent type registry**. |
| 4 | `tools.ts` | Tool registry (effect, `requiresApproval`, scopes, `ships`). Per-workspace settings can disable a tool or tighten its approval, never loosen it. MCP adapter. |
| 5 | `automation.ts` | Cron schedules (in the workspace timezone), event triggers and notifications. A firing only **submits a goal**, so it goes through the same gate as everything else. |
| 6 | `trust.ts` | Approval gate, RERA + AI-label compliance, audit trail / trace, checkpoints + rollback, permission scopes, isolation of untrusted input. |
| 7 | `runlog.ts` | The task board for each goal: todo / doing / done / blocked / failed, what each sub-agent did, and what is left. |

Supporting files: `store.ts` (workspace-scoped persistence: Supabase, file or memory), `types.ts` (contracts), `cron.ts`, `index.ts` (wiring). `stubs.ts` holds **test stubs only**. They are registered only by the verify script or by `MARKETING_HARNESS_STUBS=true`.

Model calls go through `lib/llm`. Any OpenAI-compatible provider works. Provider order is set per route (`harness-planner`, `harness-agent`), and the call falls back to the next provider on error or bad output. See `.env.example`.

## Guardrails (built into the spine)

- **Outbound is always approved by a human.** This covers send, publish, ad spend, pricing and go-live, at every autonomy level, whatever started the action: an operator, a schedule or an event. Registration refuses an outbound tool that lacks `requiresApproval: true`, the `outbound:<kind>` scope, or (for send, publish and go-live) `ships()`. The gate also forces approval even if a tool definition were mutated.
- **RERA + AI label.** Every item that ships must carry the `RERA Reg. No.: …` line and an AI label when AI touched it. This is checked before the approval card is created and again just before execution.
- **Autonomy, per workspace** (new workspaces start OFF and in suggest-only):
  - `suggest-only`: plans and reads only. Every write becomes a *suggestion* to approve. Schedules only plan.
  - `approve-each`: runs, but every write (internal or outbound) waits for approval.
  - `autonomous-within-guardrails`: internal writes (drafts, memory) run without approval. Outbound still waits.
- **Untrusted input.** Content from leads, events and MCP results is sanitized and fenced whenever it is shown to a model. Text that looks like an injection attempt is flagged to the operator. A run that has read untrusted content can never write without approval.
- **Tenant isolation.** Modules receive a `ScopedStore` bound to one workspace. A write that names another workspace is refused. In the API, a non-member gets 404.

## Registration seams: adding a feature

A feature is a module that registers its parts when it is imported. Create `lib/marketing/harness/features.ts` with the first feature and import it once from `index.ts`.

```ts
// lib/marketing/features/content.ts — EXAMPLE (not built)
import { z } from "zod";
import { registerTool, registerAgentType } from "@/lib/marketing/harness";

// 1. A tool. effect: read | internal | outbound.
registerTool({
  name: "draft_social_post",
  description: "Drafts a post for a project from company memory (saved as a draft).",
  inputSchema: z.object({ projectKey: z.string(), angle: z.string() }),
  effect: "internal",                 // the workspace's own drafts — reversible via checkpoints
  requiresApproval: false,
  scopes: ["memory:read", "content:write"],
  handler: async (input, ctx) => {
    const project = await ctx.memory.get("project", input.projectKey); // this workspace only
    // … compose, run the marketing claims guard, save the draft …
    return { draftId: "…" };
  },
});

// An outbound tool must declare its kind, approval, scope and what ships:
registerTool({
  name: "publish_post",
  description: "Publishes an approved draft.",
  inputSchema: z.object({ draftId: z.string(), text: z.string(), reraRegNo: z.string() }),
  effect: "outbound", outbound: "publish", requiresApproval: true,
  scopes: ["outbound:publish"],
  ships: (i) => [{ text: i.text, reraRegNo: i.reraRegNo, aiLabel: "AI-generated", aiAssisted: true }],
  handler: async (input) => { /* call the spine's publish */ },
});

// 2. A sub-agent type: which tools it may use, what it is allowed to do, how it decides.
registerAgentType({
  type: "content",
  description: "Drafts on-brand copy for projects from company memory.",
  tools: ["draft_social_post", "publish_post"],
  scopes: ["memory:read", "content:write", "outbound:publish"],
  instructions: "Draft from the project's facts only; propose publishing — a human approves.",
  // decide: optional deterministic policy. Without it, the model-driven policy picks among `tools`.
  // plan:   optional deterministic decomposition, used when no model plans.
  // verify: optional check on the output at join time.
});
```

Once both are registered, the planner can assign tasks to `content`. Before that, it names the missing capability on a **blocked** task, and the gap shows on the board.

Other seams:

| Seam | Where | Use |
|---|---|---|
| `registerMcpServer(name, client, declare)` | tools.ts | Wrap a remote MCP server's tools. Each tool must be declared (effect, scopes) first. Results are treated as untrusted. |
| `toMcpDescriptors()` | tools.ts | The registry in MCP `tools/list` shape. |
| `registerSnapshotProvider(p)` | trust.ts | Feature state that checkpoints capture and restore (built in: `memory`, `settings`, `schedules`). |
| `registerNotifier(n)` | automation.ts | Another notification channel (email, Slack…). The default stores notifications for the console. |
| `onEvent(name, fn)`, `harness().emit(ws, name, payload)` | automation.ts | Feature events, e.g. `lead.created`. Event-triggered schedules receive the payload as untrusted. |
| `setRetriever(r)` | memory.ts | Replace lexical retrieval with embeddings. |

## Registered features: M1–M3 (`lib/marketing/agents/`)

These register by default through `lib/marketing/harness/features.ts`. The test stubs register only with `MARKETING_HARNESS_STUBS=true`. Each tool wraps the existing feature logic: `generateDrafts` and the claims guard (M1); `composeLandingContent`, `QUIZ` with `classify` and the human-written `ARCHETYPE_SEQUENCES` (M2); the deterministic scoring model and the spine's attribution report (M3).

| Sub-agent | Tools (✋ = operator approval) | Scopes |
|---|---|---|
| `content` | `brandkit.get`, `content.generate`, `content.seoCopy` | memory:read, content:write (**no outbound**) |
| `funnel` | `landing.draft`, `funnel.quizConfigure`, `sequence.build`, ✋ `landing.publish` | + funnel:write, outbound:go_live |
| `distribution` | `distribution.planCalendar`, ✋ `distribution.publishPost`, ✋ `email.send`, ✋ `sequence.sendStep` | + distribution:write, outbound:publish, outbound:send |
| `analytics` | `analytics.report`, `lead.score`, `lead.archetype` (deterministic, no model) | memory:read, analytics:read |

`ads.spend` is a **seam** only. `adsSpendTool(handler)` in `lib/marketing/agents/tools.ts` builds it as an approval-gated `ad_spend` tool. It is not registered.

- **Policies are deterministic.** Each type decides from its task's own title (not the goal's words), calls its tools in order and chains their results. The model writes the copy inside `content.generate`, `content.seoCopy` and the landing strapline, through `lib/llm`. Distribution waits for content (`after: ["content"]`).
- **One send path.** Every outbound action (nurture steps including the archetype first touch, email, social publish, landing go-live) goes through `sendOutbound()` in `lib/marketing/agents/tools.ts`, only after an operator approves it. It is routed by channel. **in_app is live:** it goes through the desk's `deliver()` to premium, into the lead's conversation thread (`lead_messages`) and the prospect's inbox (`dm_messages`), recording `sent:true`. **Every other channel is a dry-run** until it is connected: the would-send is recorded with `sent:false` and clearly flagged. Each send is keyed by its approval, so it happens exactly once whichever view approved it. Every enrolled nurture step becomes its own approval when it falls due (on the previous decision, or on the engine tick), and each ends visibly: delivered, dry-run, declined, not sent or blocked. The sales engine refuses to run nurture jobs.
- **One source of truth.** Buildings, units and leads are read **only** from the premium internal API (`lib/marketing/agents/catalogue.ts`), the same source the sales desk, campaigns and buyer lists use. Premium is the one writer of inventory and the one leads store. A workspace is **linked to one premium builder** (`builderId` = the builder's name, unique across workspaces, compared ignoring case and spacing). It sees only that builder's buildings and leads, and project-page leads route to it by the building's builder. Company memory holds marketing knowledge plus harness outputs (`content_draft`, `landing_draft`, `funnel_config`, `sequence_plan`, `calendar`, `outbox`, `report`, `enrolment`), never copies of buildings or leads. Legacy `project` items with typed-in facts are kept but never read, and a real premium building always wins over a memory item with the same id.
- **What a workspace needs:** a link to its premium builder (Settings → "Link to <builder>", from the brand kit's `builderName`), and in memory a `brand_kit` / `main` → `{ builderName, toneOfVoice, defaultReraRegNo }`. Optionally `audience` / `<key>` → `{ archetype }`. A mission must **name** one of the builder's buildings; the agents never guess one.
- **Dev note:** registries live on `globalThis`, so restart `npm run dev` after changing a feature's tools or policies. Hot reload doesn't swap them.

## API (operator; workspace membership required)

| Method | Path | |
|---|---|---|
| GET / POST | `/api/marketing/workspaces` | list mine / create (OFF, suggest-only) |
| GET / PATCH | `/api/marketing/workspaces/:ws` | tools, types, engine / on-off, autonomy, members |
| GET / POST | `…/:ws/goals` | list / **goal intake** (plans now, runs in the background) |
| GET / POST | `…/:ws/goals/:id` | **run status** board (`?format=text`) / `{action: run \| cancel}` |
| GET / POST | `…/:ws/approvals`, `…/:ws/approvals/:id` | queue / `{decision: approve \| decline, note}` |
| GET / POST / PATCH / DELETE | `…/:ws/schedules[/:id]` | create / `{action: pause \| resume \| run-now \| edit}` |
| GET / POST | `…/:ws/checkpoints[/:id]` | snapshot (`scope`: `workspace`, `memory:campaign`, …) / roll back |
| GET / POST | `…/:ws/memory` | `?q=` retrieval, `?kind=` list / upsert |
| GET | `…/:ws/audit` | trace (`?goalId=`) |
| PATCH | `…/:ws/tools` | `{tool, enabled?, forceApproval?}` |
