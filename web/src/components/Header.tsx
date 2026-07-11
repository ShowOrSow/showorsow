"use client";

import Link from "next/link";
import Image from "next/image";
import { AccountMenu } from "./AccountMenu";
import { BalancePill } from "./BalancePill";
import { StaleBadge } from "./StaleBadge";
import { useSession } from "./SessionProvider";

// Global chrome header (08 §1): brand · StaleBadge · BalancePill · AccountMenu.
// The balance/stale chrome only makes sense when signed in; AccountMenu always
// renders (guest → Log in / Sign up).
export function Header() {
  const { isAuthenticated } = useSession();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/events" className="flex items-center gap-2">
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-lg font-bold tracking-tight">
            Show<span className="text-gold">or</span>Sow
          </span>
        </Link>
        <span className="hidden text-xs text-faint sm:inline">
          privacy-preserving escrow for event commitments
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isAuthenticated && (
            <>
              <StaleBadge />
              <BalancePill />
            </>
          )}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
