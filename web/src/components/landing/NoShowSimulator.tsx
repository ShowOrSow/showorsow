"use client";

import { useMemo, useState } from "react";
import { Users, TrendingDown, Coins } from "lucide-react";

// NoShowSimulator — the landing page's "do the math yourself" widget. Drag the
// headcount / no-show rate / cost-per-seat and watch what a free RSVP burns vs
// what a staked RSVP recovers. Every number is derived, nothing is invented:
//   wasted      = noShows × costPerSeat            (catering/venue you pre-paid)
//   recovered   = noShows × stake                  (forfeited stakes)
//   perAttendee = recovered / attendees            (what each shower-upper gets)
// The 40–70% default band is the range organizers report for free RSVPs.
export function NoShowSimulator() {
  const [invited, setInvited] = useState(100);
  const [noShowPct, setNoShowPct] = useState(55);
  const [costPerSeat, setCostPerSeat] = useState(12);
  const [stake, setStake] = useState(10);

  const m = useMemo(() => {
    const noShows = Math.round((invited * noShowPct) / 100);
    const attendees = invited - noShows;
    const wasted = noShows * costPerSeat;
    const recovered = noShows * stake;
    const perAttendee = attendees > 0 ? recovered / attendees : 0;
    return { noShows, attendees, wasted, recovered, perAttendee };
  }, [invited, noShowPct, costPerSeat, stake]);

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_18px_50px_-32px_rgba(16,24,32,0.35)]">
      <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
        {/* controls */}
        <div className="flex flex-col gap-5 border-b border-line p-6 lg:border-b-0 lg:border-r">
          <div>
            <h3 className="font-semibold text-text">Run the numbers</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your event, your no-show rate. See what a stake changes.
            </p>
          </div>

          <Slider
            label="People who RSVP"
            value={invited}
            min={10}
            max={500}
            step={10}
            onChange={setInvited}
            display={`${invited}`}
          />
          <Slider
            label="No-show rate"
            value={noShowPct}
            min={0}
            max={80}
            step={5}
            onChange={setNoShowPct}
            display={`${noShowPct}%`}
            hint="Free RSVPs typically run 40–70%"
          />
          <Slider
            label="Your cost per seat"
            value={costPerSeat}
            min={1}
            max={100}
            step={1}
            onChange={setCostPerSeat}
            display={`$${costPerSeat}`}
            hint="Catering, venue, swag — what you pre-pay per head"
          />
          <Slider
            label="Stake per RSVP"
            value={stake}
            min={1}
            max={100}
            step={1}
            onChange={setStake}
            display={`${stake} tokens`}
          />
        </div>

        {/* results */}
        <div className="flex flex-col justify-center gap-4 bg-accent/30 p-6">
          <Stat
            icon={<Users className="size-4" />}
            label="Actually show up"
            value={`${m.attendees} of ${invited}`}
            sub={`${m.noShows} ghost`}
          />
          <Stat
            icon={<TrendingDown className="size-4" />}
            tone="slash"
            label="Burned on empty seats"
            value={`$${fmt(m.wasted)}`}
            sub="Free RSVPs — you eat this"
          />
          <Stat
            icon={<Coins className="size-4" />}
            tone="refund"
            label="Recovered by staking"
            value={`${fmt(m.recovered)} tokens`}
            sub={`≈ ${fmt(m.perAttendee)} back to each person who came`}
          />

          <p className="mt-1 border-t border-line pt-3 text-xs leading-relaxed text-faint">
            Nobody pays a fee. Stakes are refunded to everyone who shows up —
            only the ghosts&apos; stakes move, and they move to the people who
            did come.
          </p>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  display: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="mono text-sm font-semibold text-text">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--color-refund)]"
      />
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "refund" | "slash";
}) {
  const color =
    tone === "refund" ? "text-refund" : tone === "slash" ? "text-slash" : "text-text";
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`mono mt-1 text-2xl font-semibold tabular-nums ${color}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-faint">{sub}</p>}
    </div>
  );
}
