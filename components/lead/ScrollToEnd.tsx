"use client";

import { useEffect, useRef } from "react";

/** Keeps a chat pane scrolled to its newest message (on load, after layout settles, and when a message arrives). */
export function ScrollToEnd({ count }: { count: number }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const pane = ref.current?.parentElement;
    if (!pane) return;
    const toEnd = () => (pane.scrollTop = pane.scrollHeight);
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    const late = setTimeout(toEnd, 400); // after web fonts swap in
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  }, [count]);
  return <li ref={ref} aria-hidden className="h-px" />;
}
