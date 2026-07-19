"use client";

import { useState } from "react";
import { api, ApiError, formatAmount } from "@/lib/api";
import type {
  AttendeeEventDetail,
  BalanceDelta,
  MyRsvp,
  SettlementPackage,
  User,
} from "@/lib/types";
import { useToast } from "../ToastProvider";
import { useSession } from "../SessionProvider";
import { useReceiveSheet } from "../ReceiveSheet";
import { RsvpStatusChip } from "../StatusChip";
import { SimulatedStepper, type StepperOutcome } from "../SimulatedStepper";
import { LockCard } from "./LockCard";
import { RetryStakeCard } from "./RetryStakeCard";
import { SettledCard } from "./SettledCard";

// Attendee "RSVP & Stake" state machine (08 §2, beats 3–4). Keyed on
// myRsvp.status — EVERY status renders. cids come from myRsvp.
const STAKE_STEPS = [
  "Accepting RSVP",
  "Requesting allocation from registry",
  "Locking funds",
];
const STAKE_CAPTION =
  "your wallet would normally do this — our app plays the wallet role";

export function AttendeePanel({
  detail,
  settlement,
  onMutate,
}: {
  detail: AttendeeEventDetail;
  settlement?: SettlementPackage;
  onMutate: () => void;
}) {
  const { pushError, push } = useToast();
  const { user } = useSession();
  const { openReceive } = useReceiveSheet();
  const myRsvp = detail.myRsvp;
  const ev = detail.event;

  const [busy, setBusy] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [outcome, setOutcome] = useState<StepperOutcome>("pending");

  const beforeDeadline = new Date(ev.rsvpDeadline).getTime() > Date.now();

  async function runStake(fn: () => Promise<MyRsvp>) {
    setStepping(true);
    setOutcome("pending");
    setBusy(true);
    try {
      await fn();
      setOutcome("done");
      onMutate();
      // let the "done" state show briefly, then unmount stepper via refetch
      setTimeout(() => setStepping(false), 900);
    } catch (err) {
      setOutcome("error");
      if (err instanceof ApiError && err.status === 409 && err.stage === "balance") {
        // The 409 balance toast links to the Receive sheet (08 §1) so the
        // attendee can grab test tokens without leaving the flow.
        push({
          kind: "error",
          message: "Insufficient balance — get test tokens first.",
          stage: err.stage,
          errorId: err.errorId,
          action: { label: "Get test tokens", onClick: openReceive },
        });
      } else {
        pushError(err, "Stake flow failed");
      }
      setTimeout(() => setStepping(false), 1400);
      onMutate();
    } finally {
      setBusy(false);
    }
  }

  async function simpleAction(fn: () => Promise<MyRsvp>, label: string) {
    setBusy(true);
    try {
      await fn();
      onMutate();
    } catch (err) {
      pushError(err, `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  // While the stake stepper runs, show only the stepper.
  if (stepping) {
    return (
      <section className="flex flex-col gap-3">
        <PanelHeader status={myRsvp.status} />
        <SimulatedStepper
          steps={STAKE_STEPS}
          running={outcome === "pending"}
          outcome={outcome}
          caption={STAKE_CAPTION}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <PanelHeader status={myRsvp.status} />
      {renderState()}
    </section>
  );

  function renderState() {
    switch (myRsvp.status) {
      case "invited":
        return (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
            <p className="text-sm text-muted-foreground">
              You're invited. Stake{" "}
              <span className="mono font-semibold text-gold">
                {formatAmount(ev.stakeAmount)} {ev.tokenLabel}
              </span>{" "}
              to lock your seat — refunded when you check in.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy || !myRsvp.inviteCid}
                onClick={() =>
                  myRsvp.inviteCid &&
                  runStake(() => api.accept(myRsvp.inviteCid!))
                }
                className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-50"
              >
                Accept &amp; Stake
              </button>
              <button
                disabled={busy || !myRsvp.inviteCid}
                onClick={() =>
                  myRsvp.inviteCid &&
                  simpleAction(() => api.decline(myRsvp.inviteCid!), "Decline")
                }
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted-foreground hover:text-text disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        );

      case "accepted":
        return (
          <RetryStakeCard
            busy={busy}
            rsvpCid={myRsvp.rsvpCid}
            onRetry={() =>
              myRsvp.rsvpCid && runStake(() => api.stake(myRsvp.rsvpCid!))
            }
          />
        );

      case "staked":
        return (
          <LockCard
            stakeAmount={ev.stakeAmount}
            tokenLabel={ev.tokenLabel}
            canCancel={beforeDeadline}
            busy={busy}
            onCancel={() =>
              myRsvp.rsvpCid &&
              simpleAction(() => api.cancel(myRsvp.rsvpCid!), "Cancel")
            }
          />
        );

      case "declined":
        return (
          <StaticNote>You declined this invitation.</StaticNote>
        );

      case "cancelled":
        return (
          <StaticNote>
            You cancelled — ask the organizer to re-invite you.
          </StaticNote>
        );

      case "withdrawn":
        return (
          <StaticNote tone="warn">
            You withdrew your stake — RSVP void.
          </StaticNote>
        );

      case "settled":
        return (
          <SettledCard
            checkedIn={myRsvp.checkedIn}
            delta={findMyDelta(settlement?.deltas, user)}
            tokenLabel={ev.tokenLabel}
          />
        );

      default:
        return <StaticNote>Unknown RSVP state.</StaticNote>;
    }
  }
}

function PanelHeader({ status }: { status: MyRsvp["status"] }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-semibold">Your RSVP</h2>
      <RsvpStatusChip status={status} />
    </div>
  );
}

function StaticNote({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-5 text-sm ${
        tone === "warn"
          ? "border-slash/40 text-slash"
          : "border-line text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}

// Contract pin: deltas[].party is the per-attendee DISPLAY LABEL the backend
// uses in settlements[].attendeeLabel (post-pivot: the user's name) — NOT the
// raw Canton party id. The attendee settlement response is self-scoped, but
// harden anyway: match the delta whose party equals the logged-in user's name
// or email (case-insensitive), and only fall back to deltas[0] when exactly one
// row is returned. If the backend ever leaks multiple rows, we surface nothing
// rather than another party's delta.
function findMyDelta(
  deltas: BalanceDelta[] | undefined,
  user: User | undefined,
): BalanceDelta | undefined {
  if (!deltas || deltas.length === 0) return undefined;
  if (user) {
    const keys = [user.name, user.email]
      .filter(Boolean)
      .map((k) => k.toLowerCase());
    const mine = deltas.find((d) => keys.includes(d.party.toLowerCase()));
    if (mine) return mine;
  }
  return deltas.length === 1 ? deltas[0] : undefined;
}
