"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession } from "@/components/SessionProvider";
import { BlurText } from "@/components/reactbits/BlurText";
import { Aurora } from "@/components/reactbits/Aurora";
import { NoShowSimulator } from "@/components/landing/NoShowSimulator";
import { Comparison } from "@/components/landing/Comparison";
import { FloatingCards } from "@/components/landing/FloatingCards";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  Coins,
  Ticket,
  CalendarCheck,
  Lock,
  PlayCircle,
} from "lucide-react";

export default function Home() {
  const { isAuthenticated } = useSession();
  const primaryHref = isAuthenticated ? "/events" : "/signup";
  const primaryLabel = isAuthenticated ? "Browse events" : "Get started — free";

  return (
    <div className="flex flex-col">
      {/* ---------------- Hero ---------------- */}
      {/* Luma-anatomy hero: centered headline with event cards floating around
          it. Aurora + dot grid give depth; the cards carry the stake chip that
          makes them ours, not Luma's. */}
      <section className="relative overflow-hidden border-b border-line">
        <Aurora />
        <FloatingCards />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center sm:px-6 lg:py-36">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-line bg-surface px-3 py-1 text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-refund" />
            Built on Canton Network
          </Badge>

          {/* React Bits BlurText — words blur-settle in sequence; the emerald
              segment keeps its color by rendering as its own delayed segment. */}
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-text sm:text-6xl lg:text-7xl">
            <BlurText text="Events people" />{" "}
            <BlurText text="actually show up" delay={0.12} className="text-refund" />{" "}
            <BlurText text="to." delay={0.3} />
          </h1>

          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            ShowOrSow adds a small, refundable token stake to every RSVP.
            Attendees get it back when they show up — no-shows forfeit theirs.
            Private by default, settled instantly on Canton.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button asChild size="lg" className="gap-2 rounded-full px-6">
              <Link href={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            {/* Browsing needs no account — send everyone to the public feed. */}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-line px-6"
            >
              <Link href="/discover">Browse events</Link>
            </Button>
          </div>

          <p className="text-sm text-faint">
            No flaky RSVPs · No public guest list · No manual payouts
          </p>
        </div>
      </section>

      {/* ---------------- Demo video ---------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto w-full max-w-4xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-text">
              See it run
            </h2>
            <p className="mt-3 text-muted-foreground">
              Three minutes: RSVP with a stake, scan in at the door, settle —
              refunds and slashes on a real ledger.
            </p>
          </div>
          <div className="mt-10">
            <DemoVideo />
          </div>
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

      {/* ---------------- Simulator ---------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-text">
              What no-shows actually cost you
            </h2>
            <p className="mt-3 text-muted-foreground">
              Move the sliders to match your event. The left side is what you
              burn today; the right side is what a stake gives back.
            </p>
          </div>
          <div className="mt-10">
            <NoShowSimulator />
          </div>
        </div>
      </section>

      {/* ---------------- Comparison ---------------- */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-text">
            Free tools, paid tickets, or skin in the game
          </h2>
          <p className="mt-3 text-muted-foreground">
            Paid tickets do fix no-shows — by charging people who show up.
            ShowOrSow only charges the ones who don&apos;t.
          </p>
        </div>
        <div className="mt-10 rounded-3xl border border-line bg-surface p-2 sm:p-4">
          <Comparison />
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
          <div className="flex items-center gap-4 text-sm">
            <Link href="/proof" className="text-muted-foreground hover:text-refund">
              DevNet receipts
            </Link>
            <span className="text-faint">
              Built on Canton Network · CIP-56 token standard
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// DemoVideo — the walkthrough slot. Drops in an embed the moment
// NEXT_PUBLIC_DEMO_VIDEO_URL is set (YouTube/Loom share URL); until then it
// shows a placeholder that links to the live demo instead of a dead frame.
function DemoVideo() {
  const url = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
  if (url) {
    return (
      <div className="overflow-hidden rounded-3xl border border-line bg-ink shadow-[0_18px_50px_-30px_rgba(16,24,32,0.4)]">
        <div className="relative aspect-video">
          <iframe
            src={url}
            title="ShowOrSow demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-line bg-ink text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-refund">
        <PlayCircle className="size-7" />
      </span>
      <div>
        <p className="font-medium text-text">Demo video coming shortly</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Meanwhile, the live app is one click away.
        </p>
      </div>
      <Button asChild variant="outline" className="rounded-full border-line">
        <Link href="/discover">Open the live demo</Link>
      </Button>
    </div>
  );
}
