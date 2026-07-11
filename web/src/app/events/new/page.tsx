"use client";

import Link from "next/link";
import { EventForm } from "@/components/EventForm";
import { useSession } from "@/components/SessionProvider";
import { isOrganizer } from "@/lib/persona";

// /events/new — Create event (organizer only, 08 §2).
export default function NewEventPage() {
  const { persona, isLoading } = useSession();

  if (!isLoading && !isOrganizer(persona)) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <p className="text-muted">Only the organizer can create events.</p>
        <Link href="/events" className="mt-3 inline-block text-sm text-gold">
          ← Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5">
        <Link href="/events" className="text-sm text-muted hover:text-text">
          ← Events
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Create Event</h1>
        <p className="text-sm text-muted">
          Set the stake and deadlines. Attendees stake to RSVP.
        </p>
      </div>
      <EventForm />
    </div>
  );
}
