"use client";

import { useState } from "react";
import { useSession } from "./SessionProvider";
import { PERSONA_COLOR, personaInitial } from "@/lib/persona";
import { PERSONAS, type Persona } from "@/lib/types";
import { truncatePartyId } from "@/lib/api";

// PersonaSwitcher (08 §1): dropdown Organizer · Alice · Bob · Charlie →
// POST /api/session; avatar color per persona; truncated party ID on hover.
// Switching = full refetch (the privacy demo control).
export function PersonaSwitcher() {
  const { session, persona, switchPersona } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const active: Persona = persona ?? "Organizer";

  async function pick(p: Persona) {
    setOpen(false);
    if (p === persona) return;
    setBusy(true);
    try {
      await switchPersona(p);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-faint disabled:opacity-60"
        title={session?.partyId ? truncatePartyId(session.partyId) : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Avatar persona={active} />
        <span className="font-medium">{active}</span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
          >
            {PERSONAS.map((p) => (
              <li key={p}>
                <button
                  role="option"
                  aria-selected={p === persona}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 ${
                    p === persona ? "bg-surface-2" : ""
                  }`}
                >
                  <Avatar persona={p} />
                  <span>{p}</span>
                  {p === persona && <span className="ml-auto text-gold">●</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Avatar({ persona }: { persona: Persona }) {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-ink"
      style={{ backgroundColor: PERSONA_COLOR[persona] }}
      aria-hidden
    >
      {personaInitial(persona)}
    </span>
  );
}
