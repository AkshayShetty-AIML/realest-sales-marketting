"use client";

import { useState, useTransition } from "react";
import { repCheckInAction, sendBookingLinkAction, startSequenceAction, stopRunAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { CalendarIcon, MapPinIcon } from "@/components/icons";

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (action: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      const r = await action();
      setMsg(r.ok ? (r.note ? { ok: true, text: r.note } : null) : { ok: false, text: r.error });
    });
  const feedback = msg ? <p role="status" className={`mt-2 text-[12px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p> : null;
  return { pending, go, feedback, setMsg };
}

export function SendBookingLink({ leadId }: { leadId: string }) {
  const { pending, go, feedback } = useRun();
  return (
    <div>
      <Button size="sm" disabled={pending} onClick={() => go(() => sendBookingLinkAction(leadId))}>
        <CalendarIcon size={15} /> Send booking link
      </Button>
      {feedback}
    </div>
  );
}

export function RepCheckIn({ leadId, visitId }: { leadId: string; visitId: string }) {
  const { pending, go, feedback, setMsg } = useRun();
  const [locating, setLocating] = useState(false);
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending || locating}
        onClick={() => {
          if (!("geolocation" in navigator)) return setMsg({ ok: false, text: "This device can't share its location." });
          setLocating(true);
          navigator.geolocation.getCurrentPosition(
            (p) => {
              setLocating(false);
              go(() => repCheckInAction(leadId, visitId, p.coords.latitude, p.coords.longitude, Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null));
            },
            () => {
              setLocating(false);
              setMsg({ ok: false, text: "Location permission is needed to check in." });
            },
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
          );
        }}
      >
        <MapPinIcon size={15} /> {locating ? "Locating…" : "Check in at the site"}
      </Button>
      {feedback}
    </div>
  );
}

export function StopRun({ leadId, runId }: { leadId: string; runId: string }) {
  const { pending, go, feedback } = useRun();
  return (
    <span>
      <Button variant="ghost" size="sm" className="!h-7 !px-2 text-[12px]" disabled={pending} onClick={() => go(() => stopRunAction(leadId, runId))}>Stop</Button>
      {feedback}
    </span>
  );
}

export function StartSequence({ leadId, options }: { leadId: string; options: { id: string; name: string }[] }) {
  const { pending, go, feedback } = useRun();
  const [id, setId] = useState("");
  if (options.length === 0) return null;
  return (
    <div>
      <div className="flex gap-2">
        <Select value={id} onChange={(e) => setId(e.target.value)} aria-label="Sequence" className="!h-9 text-[13px]">
          <option value="">Start a sequence…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Button variant="secondary" size="sm" className="!h-9" disabled={!id || pending} onClick={() => go(() => startSequenceAction(leadId, id))}>Start</Button>
      </div>
      {feedback}
    </div>
  );
}
