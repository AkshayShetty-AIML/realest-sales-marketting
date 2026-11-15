/**
 * SALES-SIDE STATE ONLY — this app's own data, keyed by PREMIUM lead ids.
 * Nothing here copies premium data: leads, messages (both directions — inbound
 * WhatsApp is appended to the premium thread), visits and inventory are read
 * live from the premium API. Two backends implement it (lib/store/file.ts,
 * lib/store/supabase.ts); callers only see this interface.
 *
 * Privacy: no raw buyer contact is stored. WhatsApp routing and the 24-hour
 * window are keyed by a peppered phone HASH.
 */

export interface Rep {
  id: string;
  name: string;
  email: string;
  /** Localities this rep covers — routing prefers a match. */
  localities: string[];
  active: boolean;
  /** Set when the rep signs in with Clerk; maps the session to this rep. */
  clerkUserId: string | null;
  /** Demo record (npm run demo:seed) — never routed real leads; removed by npm run demo:clear. */
  demo?: boolean;
}

export interface Assignment {
  id: string;
  leadId: string;
  repId: string;
  assignedAt: string;
  /** "routing:locality", "routing:least-loaded", or the rep id who reassigned. */
  assignedBy: string;
  reason: string;
}

export type OptInStatus = "opted_in" | "opted_out";

export interface OptIn {
  leadId: string;
  channel: "whatsapp";
  status: OptInStatus;
  /** Where consent came from: "premium-inquiry-form", "rep-recorded", "inbound-message", "demo-seed". */
  source: string;
  recordedAt: string;
  /** True when no real buyer gave it (demo seed / sandbox). */
  simulated: boolean;
}

export type AutoReplyOutcome = "sent" | "handoff" | "failed";

export interface AutoReply {
  leadId: string;
  outcome: AutoReplyOutcome;
  channel: "whatsapp" | "in_app";
  /** "llm" (grounded model, guard passed) or "template" (deterministic, from facts). */
  engine: "llm" | "template";
  body: string;
  /** Fact keys the reply rests on — the audit trail for "grounded". */
  factKeys: string[];
  handoffReason: string | null;
  /** Twilio message SID, or null for in-app. */
  providerId: string | null;
  at: string;
}

export interface ConversationState {
  leadId: string;
  /** "ai" = automation may reply; "human" = a rep has taken over, automation is silent. */
  mode: "ai" | "human";
  takenOverBy: string | null;
  takenOverAt: string | null;
  /** The AI's grounded draft after the buyer's latest message, waiting for a rep. */
  suggestedDraft?: { body: string; factKeys: string[]; humanTopics: string[]; at: string } | null;
}

/** The WhatsApp customer-service window, per destination number (hashed). */
export interface WaSession {
  phoneHash: string;
  /** Last message RECEIVED from this number — free-form replies are allowed for 24 h after it. */
  lastInboundAt: string;
}

export type WaStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "undelivered";

/** One outbound WhatsApp attempt and its Twilio delivery status (shown in the thread). */
export interface WaMessage {
  id: string;
  leadId: string;
  /** The premium thread message it was logged as; null when the send failed (never logged). */
  premiumMessageId: string | null;
  /** Twilio Message SID; null when Twilio refused it outright. */
  sid: string | null;
  status: WaStatus;
  errorCode: string | null;
  errorMessage: string | null;
  /** What was sent (the rendered template text when a template was used). */
  body: string;
  template: boolean;
  sentBy: string;
  at: string;
  updatedAt: string;
}

// ─── Sequences (Batch 2) ────────────────────────────────────────────────────

/**
 * What starts a sequence.
 *  inquiry_received   right after the instant reply (post-inquiry follow-up)
 *  no_reply           our last message is unanswered for `afterHours`
 *  cold_lead          no activity at all for `afterDays` (reactivation)
 *  visit_booked       a visit is booked — step offsets are relative to the SLOT (negative = before)
 *  visit_no_show      a visit was marked no_show (recovery)
 *  feedback_interested  post-visit feedback said "interested"
 *  feedback_objection   post-visit feedback raised `objection`
 */
export type SequenceTrigger =
  | "inquiry_received"
  | "no_reply"
  | "cold_lead"
  | "visit_booked"
  | "visit_no_show"
  | "feedback_interested"
  | "feedback_objection"
  /** Marketing workspace: a lead enrolled in a campaign → the sequence for its archetype (params.archetype). */
  | "campaign_enrolled";

export type Objection = "price" | "location" | "size_layout" | "possession" | "amenities" | "other";

export type StepChannel = "in_app" | "whatsapp" | "sms" | "email";

export interface SequenceStep {
  /** Hours after the trigger (or relative to the visit slot for visit_booked; may be negative). */
  offsetHours: number;
  channel: StepChannel;
  /** Text with {{variables}} ({{name|fallback}} allowed). See lib/automation/templates.ts. */
  template: string;
}

export interface Sequence {
  id: string;
  name: string;
  trigger: SequenceTrigger;
  /** no_reply: afterHours · cold_lead: afterDays · feedback_objection: objection. */
  params: { afterHours?: number; afterDays?: number; objection?: Objection; archetype?: string };
  steps: SequenceStep[];
  active: boolean;
  /** Stop remaining steps once the buyer writes back. */
  stopOnReply: boolean;
  updatedAt?: string;
}

export interface SequenceRun {
  id: string;
  sequenceId: string;
  leadId: string;
  startedAt: string;
  /** What step offsets are measured from (the trigger time, or the visit slot). */
  anchorAt: string;
  visitId: string | null;
  status: "active" | "completed" | "stopped";
  stopReason: string | null;
}

/**
 * One scheduled send. in_app is DELIVERED (premium thread); whatsapp / sms /
 * email are QUEUED and logged as "pending_twilio" — never sent while Twilio is parked.
 */
export type JobStatus = "pending" | "running" | "sent" | "pending_twilio" | "skipped" | "cancelled" | "failed";

export interface Job {
  id: string;
  leadId: string;
  runId: string | null;
  sequenceId: string | null;
  stepIndex: number | null;
  channel: StepChannel;
  /** Template (rendered at send time, so links and names are current). */
  template: string;
  /** What was (or would be) sent, after rendering. */
  body: string | null;
  runAt: string;
  status: JobStatus;
  note: string | null;
  premiumMessageId: string | null;
  createdAt: string;
  executedAt: string | null;
  /** Who queued it: a sequence, the scheduler, or a rep id. */
  source: string;
}

// ─── Visits (sales-side index of premium visits) ───────────────────────────

/** Premium has no "list visits" endpoint, so the desk indexes the visits it books — for capacity and reminders. */
export interface VisitRecord {
  visitId: string;
  leadId: string;
  propertyId: string;
  slot: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: "self-booking" | "rep" | "reschedule";
  createdAt: string;
  updatedAt: string;
}

export interface CheckIn {
  id: string;
  visitId: string;
  leadId: string;
  /** "visitor" (the buyer, from their link) or the rep id. */
  by: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: string;
  /** Distance from the property's coordinates. */
  distanceM: number;
  /** Within CHECKIN_RADIUS_M of the property — counts as proof of visit. */
  onSite: boolean;
}

export type Interest = "interested" | "maybe" | "not_interested";

export interface Feedback {
  id: string;
  visitId: string;
  leadId: string;
  interest: Interest;
  objections: Objection[];
  rating: number | null;
  comment: string;
  at: string;
  /** What the desk did with it ("stage → negotiation; started Interested follow-up"). */
  actions: string[];
}

/** A short, random, revocable link for the buyer (booking, visit management, feedback, brochure). */
export type LinkPurpose = "book" | "visit" | "feedback" | "brochure";

export interface LinkToken {
  token: string;
  purpose: LinkPurpose;
  leadId: string;
  visitId: string | null;
  /** purpose "brochure": which brochure the link opens. */
  brochureId?: string | null;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
}

/**
 * A PERSONALISED BROCHURE — the composed content is stored (a snapshot of what
 * was said, and on which facts), and the PDF is rendered from it on demand, so
 * a download is always exactly what the buyer was sent.
 */
export interface Brochure {
  id: string;
  leadId: string;
  propertyId: string;
  content: import("../brochure/content").BrochureContent;
  /** "llm" when the AI wrote the narrative (and it passed the guard), else "template". */
  engine: "llm" | "template";
  fallbackReason: string | null;
  createdAt: string;
  createdBy: string;
  /** Deliveries: in_app sends (premium message id) and queued channels. */
  deliveries: { channel: string; status: "sent" | "pending_twilio" | "failed"; at: string; note: string | null; premiumMessageId: string | null }[];
}

export interface VisitSettings {
  daysAhead: number;
  /** IST hours, e.g. 10 → 10:00. */
  startHour: number;
  endHour: number;
  slotMinutes: number;
  /** Concurrent visits per property per slot. */
  capacityPerSlot: number;
  /** 0 = Sunday … 6 = Saturday, IST. */
  closedWeekdays: number[];
  /** Earliest bookable slot is this many hours from now. */
  minNoticeHours: number;
}

export interface AuditEvent {
  id: string;
  at: string;
  kind: string;
  leadId: string | null;
  actor: string;
  detail: string;
}

/**
 * TIME TO FIRST REPLY — one row per new lead, from its arrival in the shared
 * leads store (premium createdAt) to the first message the desk or the
 * marketing first-touch put on its thread. A pointer and two timestamps — no
 * lead data. The campaign dashboard reads the median and the share under 90 s.
 */
export interface FirstReply {
  leadId: string;
  arrivedAt: string;
  /** Null while nothing has gone out (a held draft waiting for approval, or blocked). */
  firstReplyAt: string | null;
  ms: number | null;
  /** auto_first_reply = marketing first-touch (no approval); instant_reply = the desk's grounded reply; approved_draft = released by an operator; rep_reply = a rep answered first. */
  path: "auto_first_reply" | "instant_reply" | "approved_draft" | "rep_reply" | null;
  status: "replied" | "awaiting_approval" | "blocked";
  /** Message types that went out automatically (acknowledgement, archetype_welcome, brochure, grounded_answer). */
  types: string[];
  note: string | null;
  workspaceId: string | null;
  campaignId: string | null;
  /** The rep was alerted (over 90 s, or approval needed, or blocked). */
  alertedAt: string | null;
}

/** "Tell me when it's ready" on the builder Services page. */
export interface ServiceInterest {
  id: string;
  service: string;
  repId: string;
  at: string;
}

export interface SalesStore {
  readonly kind: "file" | "supabase";
  listReps(): Promise<Rep[]>;
  upsertRep(rep: Rep): Promise<void>;
  deleteRep(id: string): Promise<void>;
  listAssignments(leadId?: string): Promise<Assignment[]>;
  addAssignment(assignment: Assignment): Promise<void>;
  getOptIn(leadId: string): Promise<OptIn | null>;
  listOptIns(): Promise<OptIn[]>;
  setOptIn(optIn: OptIn): Promise<void>;
  getAutoReply(leadId: string): Promise<AutoReply | null>;
  listAutoReplies(): Promise<AutoReply[]>;
  /** Returns false when one already exists — the idempotency lock for a lead. */
  claimAutoReply(reply: AutoReply): Promise<boolean>;
  updateAutoReply(reply: AutoReply): Promise<void>;
  getConversation(leadId: string): Promise<ConversationState | null>;
  setConversation(state: ConversationState): Promise<void>;
  listConversations(): Promise<ConversationState[]>;
  touchWaSession(phoneHash: string, at: string): Promise<void>;
  getWaSession(phoneHash: string): Promise<WaSession | null>;
  addWaMessage(message: WaMessage): Promise<void>;
  updateWaMessage(id: string, patch: Partial<Omit<WaMessage, "id">>): Promise<void>;
  findWaMessageBySid(sid: string): Promise<WaMessage | null>;
  listWaMessages(leadId: string): Promise<WaMessage[]>;
  /** Claims an inbound Twilio Message SID; false if it was already processed (webhook and poller can't both handle it). */
  claimInboundSid(sid: string): Promise<boolean>;
  indexContact(phoneHash: string, leadId: string): Promise<void>;
  leadForContact(phoneHash: string): Promise<string | null>;
  listSequences(): Promise<Sequence[]>;
  upsertSequence(sequence: Sequence): Promise<void>;
  deleteSequence(id: string): Promise<void>;
  listRuns(filter?: { leadId?: string; status?: SequenceRun["status"] }): Promise<SequenceRun[]>;
  upsertRun(run: SequenceRun): Promise<void>;
  listJobs(filter?: { leadId?: string; status?: JobStatus; dueBefore?: string }): Promise<Job[]>;
  upsertJob(job: Job): Promise<void>;
  /** pending → running, atomically; false if someone else took it. */
  claimJob(id: string): Promise<boolean>;
  listVisits(filter?: { leadId?: string; propertyId?: string }): Promise<VisitRecord[]>;
  upsertVisit(visit: VisitRecord): Promise<void>;
  addCheckIn(checkIn: CheckIn): Promise<void>;
  listCheckIns(filter?: { leadId?: string; visitId?: string }): Promise<CheckIn[]>;
  addFeedback(feedback: Feedback): Promise<void>;
  listFeedback(filter?: { leadId?: string; visitId?: string }): Promise<Feedback[]>;
  addLink(link: LinkToken): Promise<void>;
  getLink(token: string): Promise<LinkToken | null>;
  touchLink(token: string, usedAt: string): Promise<void>;
  upsertBrochure(brochure: Brochure): Promise<void>;
  getBrochure(id: string): Promise<Brochure | null>;
  listBrochures(filter?: { leadId?: string }): Promise<Brochure[]>;
  getVisitSettings(): Promise<VisitSettings | null>;
  setVisitSettings(settings: VisitSettings): Promise<void>;
  audit(event: AuditEvent): Promise<void>;
  listAudit(leadId?: string, limit?: number): Promise<AuditEvent[]>;
  getCursor(name: string): Promise<string | null>;
  setCursor(name: string, value: string): Promise<void>;
  getFirstReply(leadId: string): Promise<FirstReply | null>;
  upsertFirstReply(row: FirstReply): Promise<void>;
  listFirstReplies(): Promise<FirstReply[]>;
  addServiceInterest(row: ServiceInterest): Promise<void>;
  listServiceInterests(): Promise<ServiceInterest[]>;
}
