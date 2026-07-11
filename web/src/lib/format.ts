// Small formatting utilities shared across components.

export function timeLeft(deadlineIso: string, now: number): {
  ms: number;
  label: string;
  expired: boolean;
} {
  const target = new Date(deadlineIso).getTime();
  const ms = target - now;
  if (Number.isNaN(target)) return { ms: 0, label: "—", expired: true };
  if (ms <= 0) return { ms, label: "closed", expired: true };

  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  let label: string;
  if (d > 0) label = `${d}d ${h}h`;
  else if (h > 0) label = `${h}h ${m}m`;
  else if (m > 0) label = `${m}m ${sec}s`;
  else label = `${sec}s`;

  return { ms, label, expired: false };
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toIsoFromLocalInput(v: string): string {
  // datetime-local yields "YYYY-MM-DDTHH:mm" in local time; convert to ISO.
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
