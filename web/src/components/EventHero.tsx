"use client";

import type { EventCore, EventMeta } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { EventStatusChip } from "./StatusChip";
import { Calendar, MapPin, Ticket } from "lucide-react";

// EventHero — Luma-style event presentation shared by both roles: cover
// (imageUrl or a deterministic gradient), title, host row, icon detail tiles,
// and the About section. The role-specific action UI renders NEXT to this
// (attendee registration card / organizer manage panels), not inside it.

const COVERS = [
  "from-emerald-400/70 via-teal-300/60 to-sky-300/60",
  "from-sky-400/70 via-indigo-300/60 to-violet-300/60",
  "from-amber-300/70 via-orange-300/60 to-rose-300/60",
  "from-violet-400/70 via-fuchsia-300/60 to-pink-300/60",
];

export function coverFor(eventId: string): string {
  let h = 0;
  for (let i = 0; i < eventId.length; i++) h = (h * 31 + eventId.charCodeAt(i)) | 0;
  return COVERS[Math.abs(h) % COVERS.length];
}

/** "alice-62e98b::1220…" → "Alice" (party hint prefix = signup name slug). */
export function hostLabel(party: string | undefined): string | undefined {
  if (!party) return undefined;
  const hint = party.split("::")[0] ?? "";
  const name = hint.split("-")[0];
  if (!name) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function EventHero({ ev, meta }: { ev: EventCore; meta?: EventMeta }) {
  const host = hostLabel(ev.organizerParty);
  const venue = ev.venue || meta?.venue;
  const description = ev.description || meta?.description;

  return (
    <div className="flex flex-col gap-6">
      {/* Cover */}
      <div
        className={`relative flex h-52 items-end overflow-hidden rounded-3xl bg-gradient-to-br sm:h-64 ${coverFor(ev.eventId)}`}
      >
        {meta?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <Ticket
            className="absolute right-6 top-6 size-16 rotate-12 text-white/40"
            aria-hidden
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
        <div className="relative z-10 p-5">
          <EventStatusChip status={ev.status} />
        </div>
      </div>

      {/* Title + host */}
      <div className="flex flex-col gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          {ev.title}
        </h1>
        {host && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-refund">
              {host.charAt(0)}
            </span>
            Hosted by <span className="font-medium text-text">{host}</span>
          </div>
        )}
      </div>

      {/* Detail tiles (Luma-style icon rows) */}
      <div className="flex flex-col gap-3">
        <DetailTile icon={Calendar} label={formatDateTime(ev.eventEnd)} sub="Event date" />
        {venue && <DetailTile icon={MapPin} label={venue} sub="Location" />}
      </div>

      {/* About */}
      {description && (
        <div className="border-t border-line pt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
            About this event
          </h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-text">
            {description}
          </p>
        </div>
      )}
    </div>
  );
}

function DetailTile({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
