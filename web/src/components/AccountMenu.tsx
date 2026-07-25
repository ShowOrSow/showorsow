"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "./SessionProvider";
import { avatarColor, avatarInitial } from "@/lib/identity";
import { Check, Copy } from "lucide-react";

// AccountMenu (08 §1, replaces PersonaSwitcher): avatar (name initial +
// deterministic color from party id) + name; dropdown → email, truncated party
// id, Logout. Unauthenticated → Log in / Sign up.
export function AccountMenu() {
  const { user, isAuthenticated, isLoading, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isAuthenticated || !user) {
    // Don't flash the guest buttons during the very first session probe.
    if (isLoading) {
      return <div className="h-8 w-8 animate-pulse rounded-full bg-surface-2" />;
    }
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-text"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const color = avatarColor(user.partyId);

  async function doLogout() {
    setOpen(false);
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm hover:border-faint disabled:opacity-60"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-ink"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {avatarInitial(user.name, user.email)}
        </span>
        <span className="hidden font-medium sm:inline">{user.name}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-ink"
                style={{ backgroundColor: color }}
                aria-hidden
              >
                {avatarInitial(user.name, user.email)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">
                  {user.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            {/* The party id is the user's real on-ledger identity — show the
                readable hint in full (it is what faucets and organizers ask
                for) and let the whole thing be copied in one click. */}
            <div className="px-4 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-faint">
                Canton party
              </p>
              <p className="mono mt-0.5 break-all text-xs font-medium text-text">
                {user.partyId.split("::")[0]}
                <span className="text-faint">::{user.partyId.split("::")[1]?.slice(0, 6)}…</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(user.partyId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-refund hover:underline"
              >
                {copied ? (
                  <>
                    <Check className="size-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> Copy full party id
                  </>
                )}
              </button>
            </div>
            <button
              role="menuitem"
              onClick={doLogout}
              disabled={busy}
              className="flex w-full items-center border-t border-line px-4 py-2.5 text-left text-sm text-text hover:bg-surface-2 disabled:opacity-60"
            >
              {busy ? "Logging out…" : "Log out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
