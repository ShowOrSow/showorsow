"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";
import { ToastProvider } from "./ToastProvider";
import { SessionProvider } from "./SessionProvider";

// App-wide client providers: SWR (plain fetch + polling), session (logged-in
// account + route guard), and error toasts. 08 §1 chrome hangs off these.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: string) => fetcher(key),
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      }}
    >
      <ToastProvider>
        <SessionProvider>{children}</SessionProvider>
      </ToastProvider>
    </SWRConfig>
  );
}
