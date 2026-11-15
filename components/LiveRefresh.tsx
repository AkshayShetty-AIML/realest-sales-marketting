"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Re-renders the page from the server every `seconds` while the tab is
 * visible, so new premium leads appear without a manual reload. Shows when it
 * last refreshed.
 */
export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<string>(() => new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted" aria-live="polite">
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
      <span suppressHydrationWarning>Live · updated {at}</span>
    </span>
  );
}
