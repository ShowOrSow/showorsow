"use client";

import { useEffect, useRef, useState } from "react";

// SimulatedStepper (08 §4): client-side timers that advance through named steps
// and SNAP to done/error when the POST resolves. Respects prefers-reduced-motion
// (no server-pushed progress transport exists — steppers are simulated, 08 §5).
//
// `running` — POST in flight. `outcome` — set to 'done' | 'error' when it resolves.
export type StepperOutcome = "pending" | "done" | "error";

export function SimulatedStepper({
  steps,
  running,
  outcome,
  caption,
  perStepMs = 900,
}: {
  steps: string[];
  running: boolean;
  outcome: StepperOutcome;
  caption?: string;
  perStepMs?: number;
}) {
  const [active, setActive] = useState(0);
  const reduced = usePrefersReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Advance on timers while running; snap to last step on resolution.
  useEffect(() => {
    if (!running) return;
    setActive(0);
    if (reduced) return; // don't animate — just show step 0 until snap

    let i = 0;
    const tick = () => {
      i = Math.min(i + 1, steps.length - 1);
      setActive(i);
      if (i < steps.length - 1) {
        timer.current = setTimeout(tick, perStepMs);
      }
    };
    timer.current = setTimeout(tick, perStepMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [running, reduced, steps.length, perStepMs]);

  // On resolution: snap all steps to complete (done) or mark current as error.
  useEffect(() => {
    if (outcome === "done" || outcome === "error") {
      if (timer.current) clearTimeout(timer.current);
      if (outcome === "done") setActive(steps.length);
    }
  }, [outcome, steps.length]);

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <ol className="flex flex-col gap-2.5">
        {steps.map((label, i) => {
          const done = outcome === "done" || i < active;
          const isCurrent = i === active && outcome === "pending";
          const isError = outcome === "error" && i === active;
          return (
            <li key={label} className="flex items-center gap-3 text-sm">
              <Dot done={done} current={isCurrent} error={isError} reduced={reduced} />
              <span
                className={
                  isError
                    ? "text-slash"
                    : done
                      ? "text-text"
                      : isCurrent
                        ? "text-text"
                        : "text-faint"
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {caption && <p className="mt-3 text-xs italic text-muted-foreground">{caption}</p>}
    </div>
  );
}

function Dot({
  done,
  current,
  error,
  reduced,
}: {
  done: boolean;
  current: boolean;
  error: boolean;
  reduced: boolean;
}) {
  if (error) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slash text-xs text-ink">
        ✕
      </span>
    );
  }
  if (done) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-refund text-xs text-ink">
        ✓
      </span>
    );
  }
  if (current) {
    return (
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-gold ${
          reduced ? "" : "step-active"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      </span>
    );
  }
  return <span className="h-5 w-5 rounded-full border border-line" />;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
