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
//
// Mobile (< sm) splits this into two rows. Brand + balance + account alone need
// ~356px of a 375px screen, so the nav cannot share the row — it drops to a
// segmented strip underneath rather than hiding behind a hamburger, keeping
// Discover one tap away (it is the entry point for self-serve RSVPs).
export function Header() {
  const { isAuthenticated } = useSession();
  const pathname = usePathname();

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1 transition-colors sm:py-1.5",
        pathname.startsWith(href)
          ? "bg-secondary font-medium text-text"
          : "text-muted-foreground hover:bg-secondary hover:text-text",
      )}
    >
      {label}
    </Link>
  );

  // Discover is public (browsing needs no account); Events is personal.
  const navLinks = (
    <>
      {navLink("/discover", "Discover")}
      {isAuthenticated && navLink("/events", "My events")}
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 sm:h-14 sm:gap-6 sm:px-6">
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

        <nav className="hidden items-center gap-1 text-sm sm:flex">{navLinks}</nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {isAuthenticated && (
            <>
              {/* Diagnostic chip — not worth a mobile row of its own. */}
              <span className="hidden sm:block">
                <StaleBadge />
              </span>
              <BalancePill />
            </>
          )}
          <AccountMenu />
        </div>
      </div>

      <nav className="mx-auto flex max-w-6xl items-center gap-1 border-t border-line px-3 py-1 text-[13px] sm:hidden">
        {navLinks}
      </nav>
    </header>
  );
}
