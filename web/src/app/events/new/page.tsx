"use client";

import Link from "next/link";
import { EventForm } from "@/components/EventForm";

// /events/new — Create event (08 §2). Post-pivot any signed-in user can create
// one (organizer = creator, 05 §2); the SessionProvider route guard already
// redirects unauthenticated visitors to /login.
export default function NewEventPage() {
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
