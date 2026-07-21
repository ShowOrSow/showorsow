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
import { SimulatedStepper, type StepperOutcome } from "../SimulatedStepper";
import { SettledCard } from "./SettledCard";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Lock,
  PartyPopper,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

// RsvpCard — the Luma-style "Registration" card (sticky right column of the
// event page). One card, every attendee state:
//   invited      → Reserve & stake CTA (+ decline)
//   accepted     → allocation didn't land → Retry stake
//   staked       → "You're in" + stake locked (+ cancel, ONLY if not checked in)
//   checked in   → "Checked in" celebration — cancel is gone (stake committed)
//   settled      → refund / slash outcome
//   declined / cancelled / withdrawn → terminal notes
const STAKE_STEPS = [
  "Accepting RSVP",
  "Requesting allocation from registry",
  "Locking funds",
];
const STAKE_CAPTION =
  "your wallet would normally do this — our app plays the wallet role";

export function RsvpCard({
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
  const stakeLabel = `${formatAmount(ev.stakeAmount)} ${ev.tokenLabel}`;

  async function runStake(fn: () => Promise<MyRsvp>) {
    setStepping(true);
    setOutcome("pending");
    setBusy(true);
    try {
      await fn();
      setOutcome("done");
      onMutate();
      setTimeout(() => setStepping(false), 900);
    } catch (err) {
      setOutcome("error");
      if (err instanceof ApiError && err.status === 409 && err.stage === "balance") {
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

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_10px_36px_-20px_rgba(16,24,32,0.25)]">
      <div className="border-b border-line bg-ink px-5 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">
          Registration
        </p>
      </div>
      <div className="p-5">{stepping ? renderStepper() : renderState()}</div>
    </div>
  );

  function renderStepper() {
    return (
      <SimulatedStepper
        steps={STAKE_STEPS}
        running={outcome === "pending"}
        outcome={outcome}
        caption={STAKE_CAPTION}
      />
    );
  }

  function renderState() {
    // Checked in — celebration, stake committed, NO cancel. checkedIn wins over
    // any non-settled status: it only ever comes from a real on-ledger CheckIn,
    // and a checked-in attendee cannot cancel (Daml + backend enforce it), so a
    // conflicting projected status is an indexer artifact, not a real state.
    if (myRsvp.checkedIn && myRsvp.status !== "settled") {
      return (
        <div className="flex flex-col gap-4">
          <StateHeader
            icon={<PartyPopper className="size-5" />}
            tone="refund"
            title="Checked in — enjoy the event!"
            sub="The organizer confirmed you're here."
          />
          <InfoRow icon={<Lock className="size-4" />}>
            <span className="mono font-semibold text-text">{stakeLabel}</span>{" "}
            committed — refunded to you at settlement.
          </InfoRow>
        </div>
      );
    }

    switch (myRsvp.status) {
      case "invited":
        return (
          <div className="flex flex-col gap-4">
            <StateHeader
              icon={<Sparkles className="size-5" />}
              tone="refund"
              title="You're invited!"
              sub={`Reserve with a refundable ${stakeLabel} stake.`}
            />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {user?.name ? `Welcome, ${user.name}! ` : "Welcome! "}
              To join the event, reserve your spot below — stake{" "}
              <span className="mono font-semibold text-refund">{stakeLabel}</span>
              , show up and check in, and it comes straight back.
            </p>
            {user && (
              <div className="flex items-center gap-2.5 border-t border-line pt-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-refund">
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 truncate text-sm">
                  <span className="font-medium text-text">{user.name}</span>{" "}
                  <span className="text-muted-foreground">{user.email}</span>
                </span>
              </div>
            )}
            <Button
              size="lg"
              className="w-full rounded-xl"
              disabled={busy || !myRsvp.inviteCid || !beforeDeadline}
              onClick={() =>
                myRsvp.inviteCid && runStake(() => api.accept(myRsvp.inviteCid!))
              }
            >
              {beforeDeadline ? `Reserve · stake ${stakeLabel}` : "RSVP closed"}
            </Button>
            <button
              disabled={busy || !myRsvp.inviteCid}
              onClick={() =>
                myRsvp.inviteCid &&
                simpleAction(() => api.decline(myRsvp.inviteCid!), "Decline")
              }
              className="text-center text-xs text-faint transition-colors hover:text-slash disabled:opacity-50"
            >
              Can&apos;t make it? Decline the invite
            </button>
          </div>
        );

      case "accepted":
        return (
          <div className="flex flex-col gap-4">
            <StateHeader
              icon={<RefreshCcw className="size-5" />}
              tone="warn"
              title="Almost there"
              sub="Your RSVP is accepted but the stake didn't lock."
            />
            <Button
              size="lg"
              className="w-full rounded-xl"
              disabled={busy || !myRsvp.rsvpCid}
              onClick={() =>
                myRsvp.rsvpCid && runStake(() => api.stake(myRsvp.rsvpCid!))
              }
            >
              Retry stake · {stakeLabel}
            </Button>
          </div>
        );

      case "staked": // and NOT checked in (handled above)
        return (
          <div className="flex flex-col gap-4">
            <StateHeader
              icon={<CheckCircle2 className="size-5" />}
              tone="refund"
              title="You're in!"
              sub="Your spot is reserved."
            />
            <InfoRow icon={<Lock className="size-4" />}>
              <span className="mono font-semibold text-text">{stakeLabel}</span>{" "}
              locked in escrow — refunded when you check in at the event.
            </InfoRow>
            {beforeDeadline && (
              <button
                disabled={busy || !myRsvp.rsvpCid}
                onClick={() =>
                  myRsvp.rsvpCid &&
                  simpleAction(() => api.cancel(myRsvp.rsvpCid!), "Cancel")
                }
                className="text-center text-xs text-faint transition-colors hover:text-slash disabled:opacity-50"
              >
                Can&apos;t make it? Cancel registration (stake returned)
              </button>
            )}
          </div>
        );

      case "declined":
        return <Note>You declined this invitation.</Note>;

      case "cancelled":
        return <Note>You cancelled — ask the organizer to re-invite you.</Note>;

      case "withdrawn":
        return (
          <Note tone="warn">You withdrew your stake — RSVP void.</Note>
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
        return <Note>Unknown RSVP state.</Note>;
    }
  }
}

function StateHeader({
  icon,
  title,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: "refund" | "warn";
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          tone === "refund" ? "bg-accent text-refund" : "bg-slash/10 text-slash"
        }`}
      >
        {icon}
      </span>
      <div>
        <p className="font-semibold text-text">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-ink p-3 text-sm leading-relaxed text-muted-foreground">
      <span className="mt-0.5 shrink-0 text-refund">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <p
      className={`rounded-xl border p-4 text-sm ${
        tone === "warn"
          ? "border-slash/30 bg-slash/5 text-slash"
          : "border-line bg-ink text-muted-foreground"
      }`}
    >
      {children}
    </p>
  );
}

// Contract pin (copied from AttendeePanel): deltas[].party is the display
// label, not the raw party id; match on name/email, fall back only when the
// response is single-row.
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
