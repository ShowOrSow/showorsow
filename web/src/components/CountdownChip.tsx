"use client";

import { useEffect, useState } from "react";
import { timeLeft } from "@/lib/format";

// CountdownChip (08 §4): RSVP-deadline countdown. Ticks client-side each second.
export function CountdownChip({
  deadline,
  label = "RSVP",
}: {
  deadline: string;
  label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { label: t, expired } = timeLeft(deadline, now);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        expired ? "border-faint/60 text-muted" : "border-line text-text"
      }`}
      title={new Date(deadline).toLocaleString()}
    >
      <span className="text-muted">{label}</span>
      <span className="mono">{expired ? "closed" : t}</span>
    </span>
  );
}
