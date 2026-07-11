// Identity display helpers (post-pivot, replaces persona.ts). Avatars are keyed
// off real accounts now: a deterministic color derived from the Canton party id
// + an initial from the display name (08 §1 AccountMenu).

// On-brand avatar palette. Reuses the LOCKED design tokens (globals.css) so
// generated avatars stay within the ShowOrSow palette instead of arbitrary hues.
const AVATAR_PALETTE = [
  "var(--color-persona-organizer)", // gold
  "var(--color-persona-alice)", // info-blue
  "var(--color-persona-bob)", // refund-green
  "var(--color-persona-charlie)", // violet
  "var(--color-refund)",
  "var(--color-info)",
  "var(--color-slash)",
];

// Deterministic color from a stable seed (the party id). Same party → same
// color across sessions and across every surface that renders its avatar.
export function avatarColor(seed: string | undefined): string {
  if (!seed) return "var(--color-faint)";
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// First character of the display name (falls back to email, then "?").
export function avatarInitial(name?: string, fallback?: string): string {
  const s = (name || fallback || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}
