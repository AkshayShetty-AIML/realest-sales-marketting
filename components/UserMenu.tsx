"use client";

import { UserButton } from "@clerk/nextjs";
import { UserIcon } from "./icons";

const CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function UserMenu({ name, role, dark = false }: { name: string; role?: string; dark?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-[10px] px-2 py-2 ${dark ? "bg-white/5" : "border border-line bg-surface shadow-control"}`}>
      {CLERK ? (
        <UserButton />
      ) : (
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${dark ? "bg-rail-active text-rail-bg" : "bg-brand-wash text-brand"}`}><UserIcon size={16} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] font-medium ${dark ? "text-white" : "text-ink"}`}>{name}</span>
        {role && <span className={`block truncate text-[11px] ${dark ? "text-rail-muted" : "text-muted"}`}>{role}</span>}
      </span>
    </div>
  );
}
