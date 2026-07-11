"use client";

import Link from "next/link";
import { PersonaSwitcher } from "./PersonaSwitcher";
import { BalancePill } from "./BalancePill";
import { StaleBadge } from "./StaleBadge";

// Global chrome header (08 §1): brand · PersonaSwitcher · BalancePill · StaleBadge.
export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/events" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">
            Show<span className="text-gold">or</span>Sow
          </span>
        </Link>
        <span className="hidden text-xs text-faint sm:inline">
          privacy-preserving escrow for event commitments
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StaleBadge />
          <BalancePill />
          <PersonaSwitcher />
        </div>
      </div>
    </header>
  );
}
