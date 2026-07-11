"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { api, ApiError } from "@/lib/api";
import type { SessionInfo, User } from "@/lib/types";

interface SessionCtx {
  session: SessionInfo | undefined;
  user: User | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  // Full refetch after an auth change (login/logout/dev-login). This is the
  // privacy demo control: log in as Bob → Alice's data visibly disappears.
  revalidateAll: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

// Client-side route guard: any /events* page requires a session. When
// GET /api/session 401s (unauthenticated), we redirect to /login. Documented
// choice (08 §3): a client-side guard in the session provider — no Next.js
// middleware — keeps the frontend a pure SPA against the Go backend's cookie
// session, avoids duplicating auth logic at the edge, and matches the demo's
// "switch account → data refetches" model.
function isProtectedPath(pathname: string | null): boolean {
  return !!pathname && pathname.startsWith("/events");
}

// GET /api/session drives AccountMenu + StaleBadge (indexerLagMs). Polled so the
// stale badge stays live and the guard reacts to session expiry.
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const router = useRouter();
  const pathname = usePathname();

  const { data, error, isLoading, mutate } = useSWR<SessionInfo>(
    "/api/session",
    { refreshInterval: 5000 },
  );

  // Treat a 401 as definitively unauthenticated even if SWR is still holding a
  // stale `data` from before a logout (SWR keeps last data on error by default).
  const unauthorized = error instanceof ApiError && error.status === 401;
  const isAuthenticated = !!data?.user && !unauthorized;

  // Route guard — redirect unauthenticated users off protected pages.
  useEffect(() => {
    if (isLoading) return;
    if (isProtectedPath(pathname) && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, pathname, isAuthenticated, router]);

  const revalidateAll = useCallback(async () => {
    // Refetch the session first, then invalidate every other SWR key so no
    // previous account's data lingers (balances, events, detail…).
    await mutate();
    await globalMutate(() => true, undefined, { revalidate: true });
  }, [mutate, globalMutate]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Clear the session cache regardless, then hard-refetch everything.
      await mutate(undefined, { revalidate: false });
      await globalMutate(() => true, undefined, { revalidate: true });
      router.replace("/login");
    }
  }, [mutate, globalMutate, router]);

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  return (
    <Ctx.Provider
      value={{
        session: isAuthenticated ? data : undefined,
        user: isAuthenticated ? data?.user : undefined,
        isLoading,
        isAuthenticated,
        logout,
        revalidateAll,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
