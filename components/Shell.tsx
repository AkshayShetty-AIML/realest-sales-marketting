import type { ReactNode } from "react";

/** Page title block (asset sheet): Playfair H1, one plain-language line, and the screen's action on the right. */
export function PageHeader({ title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-[1.15] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-body">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
    </div>
  );
}
