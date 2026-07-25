"use client";

import type { EventCore, EventMeta } from "@/lib/types";
import { tokenLabelOf } from "@/lib/format";
import { TokenLogo } from "./TokenLogo";
import { MapPin, Ticket } from "lucide-react";

// Luma-anatomy event page building blocks (verified against luma.com):
//   left narrow column  → square cover (EventCover) + "Hosted by" / "Stake"
//                         rail (EventSideMeta)
//   right wide column   → big title + date/location tiles     (EventTitleBlock)
//                       → registration card (role-specific)
//                       → "About Event" section               (EventAbout)
//
// The rail is split in two because mobile stacks the columns: the cover leads,
// but host/stake must fall BELOW the title and Registration card rather than
// pushing them off the first screen. See the event page's `contents` wrapper.

const COVERS = [
  "from-emerald-400/80 via-teal-300/70 to-sky-300/70",
  "from-sky-400/80 via-indigo-300/70 to-violet-300/70",
  "from-amber-300/80 via-orange-300/70 to-rose-300/70",
  "from-violet-400/80 via-fuchsia-300/70 to-pink-300/70",
];

export function coverFor(eventId: string): string {
  return COVERS[hashOf(eventId) % COVERS.length];
}


function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** "alice-62e98b::1220…" → "Alice" (party hint prefix = signup name slug). */
export function hostLabel(party: string | undefined): string | undefined {
  if (!party) return undefined;
  const hint = party.split("::")[0] ?? "";
  const name = hint.split("-")[0];
  if (!name) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Square cover — leads both layouts. Capped on mobile so a full-width square
 *  does not eat the whole first screen before the title appears. */
export function EventCover({ ev, meta }: { ev: EventCore; meta?: EventMeta }) {
  return (
    <div
      className={`relative mx-auto aspect-square w-full max-w-[15rem] overflow-hidden rounded-2xl bg-gradient-to-br shadow-sm lg:max-w-none ${coverFor(ev.eventId)}`}
    >
      {meta?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <>
          <Ticket className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rotate-12 text-white/50" />
          <span className="absolute bottom-4 left-0 right-0 text-center text-sm font-semibold tracking-wide text-white/80">
            {ev.title}
          </span>
        </>
      )}
    </div>
  );
}

/** Hosted-by + stake rail. Sits under the cover on desktop; drops below the
 *  Registration card on mobile (order-last from the page's flex column). */
export function EventSideMeta({ ev }: { ev: EventCore }) {
  const host = hostLabel(ev.organizerParty);
  return (
    <div className="order-last flex flex-col gap-5 lg:order-none">
      {host && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">
            Hosted by
          </p>
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-refund">
              {host.charAt(0)}
            </span>
            <span className="text-sm font-medium text-text">{host}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">
          Stake
        </p>
        <div className="flex items-center gap-2.5">
          <TokenLogo label={tokenLabelOf(ev)} size={28} />
          <div className="leading-tight">
            <p className="mono text-sm font-semibold text-text">
              {`${Number(ev.stakeAmount)} ${tokenLabelOf(ev)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              refunded when you show up
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Right column header: big title + mini-calendar date tile + location tile. */
export function EventTitleBlock({ ev, meta }: { ev: EventCore; meta?: EventMeta }) {
  const venue = ev.venue || meta?.venue;
  // rsvpDeadline is the doors-open moment (the contract closes RSVPs and
  // refunds at it), so the header reads as a real start → end range.
  const starts = new Date(ev.rsvpDeadline);
  const d = new Date(ev.eventEnd);
  const month = starts.toLocaleDateString("en-US", { month: "short" });
  const day = starts.getDate();
  const dateLine = starts.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const hm = (x: Date) =>
    x.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = starts.toDateString() === d.toDateString();
  const timeLine = sameDay
    ? `${hm(starts)} – ${hm(d)}`
    : `${hm(starts)} – ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hm(d)}`;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-balance text-4xl font-bold tracking-tight text-text sm:text-5xl">
        {ev.title}
      </h1>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <MiniCalendar month={month} day={day} />
          <div>
            <p className="font-medium text-text">{dateLine}</p>
            <p className="text-sm text-muted-foreground">{timeLine}</p>
          </div>
        </div>
        {venue && (
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted-foreground">
              <MapPin className="size-5" />
            </span>
            <div>
              <p className="font-medium text-text">{venue}</p>
              <p className="text-sm text-muted-foreground">Location</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Luma's bordered mini-calendar chip: month band on top, day number below. */
function MiniCalendar({ month, day }: { month: string; day: number }) {
  return (
    <span className="flex size-11 shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface text-center">
      <span className="bg-secondary text-[9px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">
        {month}
      </span>
      <span className="flex flex-1 items-center justify-center text-base font-semibold text-text">
        {day}
      </span>
    </span>
  );
}

/** About section — Luma's hairline label + prose. */
export function EventAbout({ ev, meta }: { ev: EventCore; meta?: EventMeta }) {
  const description = ev.description || meta?.description;
  if (!description) return null;
  return (
    <div>
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-muted-foreground">About Event</p>
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-text">
        {description}
      </p>
    </div>
  );
}
