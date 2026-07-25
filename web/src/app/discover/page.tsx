"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { DiscoverRow } from "@/lib/types";
import { api, ApiError, formatAmount } from "@/lib/api";
import { tokenLabelOf } from "@/lib/format";
import { coverFor } from "@/components/EventHero";
import { TokenLogo } from "@/components/TokenLogo";
import { useSession } from "@/components/SessionProvider";
import { useToast } from "@/components/ToastProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, MapPin, Search, Ticket, Users, Lock } from "lucide-react";

// /discover — the PUBLIC feed (Luma's /discover anatomy: big title, search,
// then a card grid). Two things make it ours rather than a clone:
//   1. Every card shows the stake — browsing tells you the commitment up front.
//   2. Cards show "N going" but never WHO. The event is public, the guest list
//      is not; that asymmetry is the product, so the page says it out loud.
// Registering needs no invite: POST /api/events/{id}/join mints the RSVPInvite
// server-side (the backend acts as the organizer party), then the normal stake
// flow runs on the event page.
export default function DiscoverPage() {
  const { data, isLoading, error, mutate } = useSWR<DiscoverRow[]>("/api/discover");
  const { isAuthenticated } = useSession();
  const { pushError } = useToast();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [joining, setJoining] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((r) =>
      [r.event.title, r.event.venue, r.meta?.venue, r.meta?.description, r.hostLabel]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle)),
    );
  }, [data, q]);

  async function register(row: DiscoverRow) {
    const id = row.event.eventId;
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(`/events/${id}`)}`);
      return;
    }
    setJoining(id);
    try {
      await api.join(id);
      await mutate();
      router.push(`/events/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        router.push(`/events/${id}`); // already in / hosting — just go there
      } else {
        pushError(err, "Could not register");
      }
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              Discover events
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Browse events anyone can join. Reserve your seat with a refundable
              stake — no invite needed.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full border-line">
            <Link href="/events/new">Host an event</Link>
          </Button>
        </div>

        <label className="relative block max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events, hosts, or places"
            className="w-full rounded-full border border-line bg-surface py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-faint focus:border-refund/50"
          />
        </label>

        <p className="flex items-center gap-1.5 text-xs text-faint">
          <Lock className="size-3.5" />
          Events are public — the guest list never is. You&apos;ll see how many
          are going, never who.
        </p>
      </header>

      {isLoading && <SkeletonGrid />}

      {error && (
        <div className="rounded-2xl border border-slash/30 bg-surface p-6 text-sm text-slash">
          Could not load the feed. Is the backend reachable?
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-refund">
            <Ticket className="size-6" />
          </span>
          <p className="font-medium text-text">
            {q ? "No events match that search" : "No open events right now"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {q
              ? "Try a different word, or clear the search."
              : "Be the first — create an event and it shows up here instantly."}
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <DiscoverCard
            key={row.event.eventId}
            row={row}
            busy={joining === row.event.eventId}
            onRegister={() => register(row)}
          />
        ))}
      </div>
    </div>
  );
}

function DiscoverCard({
  row,
  busy,
  onRegister,
}: {
  row: DiscoverRow;
  busy: boolean;
  onRegister: () => void;
}) {
  const ev = row.event;
  const venue = ev.venue || row.meta?.venue;
  const when = new Date(ev.eventEnd);
  const dateLine = when.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLine = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const joined = !!row.myStatus && row.myStatus !== "declined" && row.myStatus !== "cancelled";

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all hover:-translate-y-0.5 hover:border-refund/40 hover:shadow-[0_14px_38px_-22px_rgba(5,150,105,0.4)]">
      <Link href={`/events/${encodeURIComponent(ev.eventId)}`} className="block">
        <div
          className={cn(
            "relative flex h-32 items-center justify-center bg-gradient-to-br",
            coverFor(ev.eventId),
          )}
        >
          <Ticket className="size-10 rotate-12 text-white/60" />
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-text shadow-sm">
            <TokenLogo label={tokenLabelOf(ev)} size={13} />
            {formatAmount(ev.stakeAmount)} {tokenLabelOf(ev)}
          </span>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/events/${encodeURIComponent(ev.eventId)}`}>
          <h3 className="line-clamp-2 font-semibold text-text group-hover:text-refund">
            {ev.title}
          </h3>
        </Link>

        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          {dateLine} · {timeLine}
        </p>
        {venue && (
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {venue}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="flex items-center gap-1.5 text-xs text-faint">
            <Users className="size-3.5" />
            {row.going} going
            {row.hostLabel && (
              <>
                <span className="text-line">·</span>
                <span className="truncate">by {row.hostLabel}</span>
              </>
            )}
          </span>

          {row.isOrganizer ? (
            <Button asChild size="sm" variant="outline" className="rounded-full border-line">
              <Link href={`/events/${encodeURIComponent(ev.eventId)}`}>Manage</Link>
            </Button>
          ) : joined ? (
            <Button asChild size="sm" variant="outline" className="rounded-full border-refund/40 text-refund">
              <Link href={`/events/${encodeURIComponent(ev.eventId)}`}>
                {row.myStatus === "staked" ? "You're in" : "Continue"}
              </Link>
            </Button>
          ) : (
            <Button size="sm" className="rounded-full" disabled={busy} onClick={onRegister}>
              {busy ? "Registering…" : "Register"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-64 animate-pulse rounded-2xl border border-line bg-surface"
        />
      ))}
    </div>
  );
}
