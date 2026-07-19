"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession } from "@/components/SessionProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  Coins,
  Ticket,
  CalendarCheck,
  Check,
  X,
  Lock,
} from "lucide-react";

export default function Home() {
  const { isAuthenticated, isLoading } = useSession();
  const primaryHref = isAuthenticated ? "/events" : "/signup";
  const primaryLabel = isAuthenticated ? "Browse events" : "Get started — free";
  const secondaryHref = isAuthenticated ? "/events/new" : "/login";
  const secondaryLabel = isAuthenticated ? "Create an event" : "Sign in";

  return (
    <div className="flex flex-col">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[46rem] -translate-x-1/2 rounded-full bg-refund/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:py-28">
          <div className="flex flex-col items-start gap-6">
            <Badge
              variant="outline"
              className="gap-1.5 rounded-full border-line bg-surface px-3 py-1 text-muted-foreground"
            >
              <span className="size-1.5 rounded-full bg-refund" />
              Built on Canton Network
            </Badge>

            <h1 className="text-balance text-4xl font-semibold tracking-tight text-text sm:text-5xl lg:text-6xl">
              Events people{" "}
              <span className="text-refund">actually show up</span> to.
            </h1>

            <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              ShowOrSow adds a small, refundable token stake to every RSVP.
              Attendees get it back when they show up — no-shows forfeit theirs.
              Private by default, settled instantly on Canton.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button asChild size="lg" className="gap-2 rounded-full px-6">
                <Link href={primaryHref}>
                  {primaryLabel}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-line px-6"
              >
                <Link href={secondaryHref}>{secondaryLabel}</Link>
              </Button>
            </div>

            <p className="text-sm text-faint">
              No flaky RSVPs · No public guest list · No manual payouts
            </p>
          </div>

          {/* Stake-outcome visual */}
          <StakeOutcomeCard />
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-text">
            How it works
          </h2>
          <p className="mt-3 text-muted-foreground">
            Three steps. The escrow does the rest — no chasing no-shows, no
            manual refunds.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: Ticket,
              step: "01",
              title: "RSVP & stake",
              body: "Reserve your seat by staking tokens into an on-ledger escrow. That’s your commitment.",
            },
            {
              icon: CalendarCheck,
              step: "02",
              title: "Show up & check in",
              body: "Attend the event and check in. The organizer confirms you were there.",
            },
            {
              icon: Coins,
              step: "03",
              title: "Settle instantly",
              body: "Showed up? Your stake is refunded. Flaked? It’s slashed. Atomic, the moment the event closes.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="group relative rounded-2xl border border-line bg-surface p-6 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-refund">
                  <s.icon className="size-5" />
                </span>
                <span className="mono text-sm font-medium text-faint">
                  {s.step}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-medium text-text">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Why ShowOrSow ---------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-text">
                Commitment you can count on — privacy you can trust.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Skin in the game turns flaky maybes into reliable turnout, while
                Canton keeps who’s attending — and how much they staked —
                between you and the organizer.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-1">
              {[
                {
                  icon: Lock,
                  title: "Private by design",
                  body: "Your stake and attendance are visible only to you and the organizer — enforced by Canton’s sub-transaction privacy. No public guest list.",
                },
                {
                  icon: ShieldCheck,
                  title: "Real commitment",
                  body: "A refundable stake filters out no-shows and gives organizers turnout they can plan around.",
                },
                {
                  icon: Zap,
                  title: "Instant settlement",
                  body: "Refunds and slashes settle atomically on-ledger when the event closes. No spreadsheets, no manual payouts.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  className="flex gap-4 rounded-2xl border border-line bg-ink p-5"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-refund">
                    <f.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-medium text-text">{f.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {f.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Demo CTA ---------------- */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-refund/20 bg-refund/[0.06] px-6 py-14 text-center sm:px-12">
          <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-5">
            <h2 className="text-3xl font-semibold tracking-tight text-text">
              Try the live demo
            </h2>
            <p className="text-muted-foreground">
              One-click login as a demo guest, grab test tokens from the faucet,
              and RSVP to an event — real stakes, live on Canton.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="gap-2 rounded-full px-6">
                <Link href={isLoading ? "/login" : primaryHref}>
                  {isAuthenticated ? "Go to events" : "Launch the demo"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
            <p className="mono text-xs text-faint">
              demo login · alice@showorsow.dev · password demo1234
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/brand/logo-mark.png"
              alt=""
              width={22}
              height={22}
              className="rounded"
            />
            <span className="font-semibold tracking-tight text-text">
              Show<span className="text-refund">or</span>Sow
            </span>
          </Link>
          <p className="text-sm text-faint">
            Built on Canton Network · CIP-56 token standard
          </p>
        </div>
      </footer>
    </div>
  );
}

function StakeOutcomeCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-[0_12px_40px_-16px_rgba(16,24,32,0.18)]">
        <div className="flex items-center justify-between rounded-2xl bg-ink px-4 py-3">
          <div>
            <p className="text-xs text-faint">You RSVP’d to</p>
            <p className="font-medium text-text">Canton Meetup · Jakarta</p>
          </div>
          <Ticket className="size-5 text-refund" />
        </div>

        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-sm text-muted-foreground">Your stake</span>
          <span className="mono font-medium text-text">5.00 SHOW</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-refund/25 bg-refund/[0.07] p-3">
            <div className="flex items-center gap-1.5 text-refund">
              <Check className="size-4" />
              <span className="text-xs font-medium">Showed up</span>
            </div>
            <p className="mono mt-2 text-lg font-semibold text-refund">
              +5.00
            </p>
            <p className="text-[11px] text-muted-foreground">refunded in full</p>
          </div>
          <div className="rounded-2xl border border-slash/25 bg-slash/[0.06] p-3">
            <div className="flex items-center gap-1.5 text-slash">
              <X className="size-4" />
              <span className="text-xs font-medium">No-show</span>
            </div>
            <p className="mono mt-2 text-lg font-semibold text-slash">−5.00</p>
            <p className="text-[11px] text-muted-foreground">stake forfeited</p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-faint">
          Settled atomically on Canton when the event closes
        </p>
      </div>
    </div>
  );
}
