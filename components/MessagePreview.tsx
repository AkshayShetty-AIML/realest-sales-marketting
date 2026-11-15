import { previewParts } from "@/lib/template-vars";

/** A sequence message as the buyer would read it (example values), never raw {{fields}}. */
export function MessagePreview({ template, className = "" }: { template: string; className?: string }) {
  const parts = previewParts(template);
  return (
    <span className={className}>
      {parts.map((p, i) => (p.link ? <span key={i} className="font-medium text-brand underline underline-offset-2">{p.text}</span> : <span key={i}>{p.text}</span>))}
      {parts.length === 0 && <span className="text-muted">Empty message</span>}
    </span>
  );
}
