"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { SettlementPackage } from "@/lib/types";
import { SimulatedStepper, type StepperOutcome } from "../SimulatedStepper";
import { useToast } from "../ToastProvider";

// SettleButton + SimulatedStepper (08 §2/§4): "Close Event & Settle" (danger-
// styled, confirm dialog) → POST .../close; while in flight a client-side
// simulated stepper (ending → contexts → settling → payouts) advances on timers
// and snaps to done/error when the POST resolves.
const CLOSE_STEPS = [
  "Ending event",
  "Fetching settlement contexts",
  "Settling stakes",
  "Distributing payouts",
];

export function SettleButton({
  eventId,
  disabled,
  onSettled,
}: {
  eventId: string;
  disabled: boolean;
  onSettled: (pkg: SettlementPackage) => void;
}) {
  const { pushError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<StepperOutcome>("pending");

  async function close() {
    setConfirming(false);
    setRunning(true);
    setOutcome("pending");
    try {
      const pkg = await api.close(eventId);
      setOutcome("done");
      setTimeout(() => {
        setRunning(false);
        onSettled(pkg);
      }, 900);
    } catch (err) {
      setOutcome("error");
      pushError(err, "Settlement failed");
      setTimeout(() => setRunning(false), 1600);
    }
  }

  if (running) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        <h3 className="font-semibold">Settling…</h3>
        <SimulatedStepper
          steps={CLOSE_STEPS}
          running={outcome === "pending"}
          outcome={outcome}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slash/30 bg-surface p-5">
      <div>
        <h3 className="font-semibold text-text">Close Event &amp; Settle</h3>
        <p className="text-sm text-muted-foreground">
          Refunds check-ins, slashes ghosts, redistributes the pot. This is final
          and on-ledger.
        </p>
      </div>

      {!confirming ? (
        <button
          disabled={disabled}
          onClick={() => setConfirming(true)}
          className="self-start rounded-lg border border-slash/60 bg-slash/10 px-4 py-2 text-sm font-semibold text-slash hover:bg-slash/20 disabled:opacity-40"
        >
          Close Event &amp; Settle
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-slash/40 bg-slash/5 p-4">
          <p className="text-sm text-text">
            Settle now? Stakes are transferred irreversibly on the ledger.
          </p>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="rounded-lg bg-slash px-4 py-2 text-sm font-semibold text-ink hover:brightness-95"
            >
              Yes, settle
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-line px-4 py-2 text-sm text-muted-foreground hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
