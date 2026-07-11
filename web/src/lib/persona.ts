import type { Persona } from "./types";

// Persona avatar colors (locked, 08 §1). Values map to CSS token vars.
export const PERSONA_COLOR: Record<Persona, string> = {
  Organizer: "var(--color-persona-organizer)",
  Alice: "var(--color-persona-alice)",
  Bob: "var(--color-persona-bob)",
  Charlie: "var(--color-persona-charlie)",
};

export function personaInitial(p: Persona): string {
  return p.charAt(0).toUpperCase();
}

export function isOrganizer(p: Persona | undefined): boolean {
  return p === "Organizer";
}
