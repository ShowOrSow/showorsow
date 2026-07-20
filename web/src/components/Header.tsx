"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AccountMenu } from "./AccountMenu";
import { BalancePill } from "./BalancePill";
import { StaleBadge } from "./StaleBadge";
import { useSession } from "./SessionProvider";
import { cn } from "@/lib/utils";

// Global chrome header: brand → landing, app nav (signed-in), StaleBadge ·
// BalancePill · AccountMenu. Guests get marketing chrome; users get app chrome.
export function Header() {
  const { isAuthenticated } = useSession();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={26}
            height={26}
            className="rounded-md"
            priority
          />
          <span className="text-[17px] font-semibold tracking-tight">
            Show<span className="text-refund">or</span>Sow
          </span>
        </Link>

        {isAuthenticated && (
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/events"
              className={cn(
                "rounded-full px-3 py-1.5 transition-colors",
                pathname.startsWith("/events")
                  ? "bg-secondary font-medium text-text"
                  : "text-muted-foreground hover:bg-secondary hover:text-text",
              )}
            >
              Events
            </Link>
          </nav>
        )}

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
