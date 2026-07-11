"use client";

import { createContext, useCallback, useContext } from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import type { Persona, SessionInfo } from "@/lib/types";
import { useToast } from "./ToastProvider";

interface SessionCtx {
  session: SessionInfo | undefined;
  isLoading: boolean;
  persona: Persona | undefined;
  switchPersona: (p: Persona) => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

// GET /api/session drives PersonaSwitcher + StaleBadge (indexerLagMs). Polled so
// the stale badge stays live.
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { pushError } = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, isLoading, mutate } = useSWR<SessionInfo>("/api/session", {
    refreshInterval: 5000,
  });

  const switchPersona = useCallback(
    async (p: Persona) => {
      try {
        const res = await api.setSession(p);
        // optimistic session update
        await mutate(
          (prev) => ({ ...(prev as SessionInfo), persona: res.persona, partyId: res.partyId }),
          { revalidate: true },
        );
        // Switching = full refetch. This is the privacy demo control: switch to
        // Bob → Alice's data visibly disappears (08 §1). Invalidate everything.
        await globalMutate(() => true, undefined, { revalidate: true });
      } catch (err) {
        pushError(err, "Could not switch persona");
      }
    },
    [mutate, globalMutate, pushError],
  );

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  return (
    <Ctx.Provider
      value={{
        session: data,
        isLoading,
        persona: data?.persona,
        switchPersona,
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
