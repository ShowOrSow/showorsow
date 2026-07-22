"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { api } from "@/lib/api";
import { isFaucetExternal, type AppConfig, type Token } from "@/lib/types";
import { TokenLogo } from "./TokenLogo";
import { useSession } from "./SessionProvider";
import { useToast } from "./ToastProvider";

// ReceiveSheet (08 §1): opened by clicking the BalancePill (or the 409
// insufficient-balance toast). Shows the user's Canton party as a copyable
// "deposit address", the CIP-56 auto-accept line, and — when the backend reports
// DEV_FAUCET (AppConfig.devFaucet) — a "Get test tokens" button per configured
// token (GET /api/tokens). The deposit address + line ALWAYS render; only the
// faucet buttons are gated. Mounted once at the app root; a context exposes
// openReceive() so any surface can pop it.

interface ReceiveSheetCtx {
  open: boolean;
  openReceive: () => void;
  closeReceive: () => void;
}

const Ctx = createContext<ReceiveSheetCtx | null>(null);

export function ReceiveSheetProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openReceive = useCallback(() => setOpen(true), []);
  const closeReceive = useCallback(() => setOpen(false), []);

  return (
    <Ctx.Provider value={{ open, openReceive, closeReceive }}>
      {children}
      {open && <ReceiveSheet onClose={closeReceive} />}
    </Ctx.Provider>
  );
}

export function useReceiveSheet(): ReceiveSheetCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useReceiveSheet must be used within ReceiveSheetProvider");
  return ctx;
}

function ReceiveSheet({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const { push, pushError } = useToast();
  const { mutate } = useSWRConfig();

  // Same config probe the dev quick-login strip uses (08 §2). devFaucet gates
  // the faucet buttons only — the deposit address always shows.
  const { data: config } = useSWR<AppConfig>("/api/config", {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const { data: tokens } = useSWR<Token[]>("/api/tokens", {
    shouldRetryOnError: false,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const partyId = user?.partyId ?? "";
  const faucetEnabled = config?.devFaucet === true;

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(partyId);
      setCopied(true);
      push({ kind: "success", message: "Party ID copied to clipboard." });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs a secure context — surface the value so it can be
      // copied by hand (mirrors InvitePanel's fallback).
      push({
        kind: "error",
        message: `Couldn't copy automatically — your party is: ${partyId}`,
      });
    }
  }

  async function getTestTokens(tokenLabel: string) {
    if (busy) return;
    setBusy(tokenLabel);
    try {
      const res = await api.faucet(tokenLabel);
      if (isFaucetExternal(res)) {
        // Registry token (cBTC/cETH): open the external faucet in a new tab and
        // tell the user which party to paste. The deposit acceptor (05 §6b)
        // catches the incoming transfer.
        if (typeof window !== "undefined") {
          window.open(res.url, "_blank", "noopener,noreferrer");
        }
        push({
          kind: "info",
          message: `Paste your party id at the faucet: ${res.party}`,
        });
      } else {
        // Mintable demo token: credited instantly. Revalidate balances so the
        // BalancePill flashes green.
        push({
          kind: "success",
          message: `Test ${tokenLabel} credited — new balance ${res.newBalance}.`,
        });
        await mutate("/api/balances");
      }
    } catch (err) {
      pushError(err, "Faucet request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receive tokens"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">Receive tokens</h2>
          <button
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Deposit address — always shown. */}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-faint">
              Your deposit address (Canton party)
            </p>
            <div className="mt-1.5 flex items-start gap-2">
              <code className="mono min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-text">
                {partyId || "—"}
              </code>
              <button
                type="button"
                onClick={copyAddress}
                disabled={!partyId}
                className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs text-muted-foreground hover:border-faint hover:text-text disabled:opacity-50"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Send any CIP-56 token to this party — incoming transfers are
              accepted automatically.
            </p>
          </div>

          {/* Faucet rows — only when DEV_FAUCET is enabled. */}
          {faucetEnabled && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-[11px] uppercase tracking-wide text-faint">
                Get test tokens
              </p>
              {!tokens && (
                <p className="text-xs text-muted-foreground">Loading tokens…</p>
              )}
              {tokens && tokens.length === 0 && (
                <p className="text-xs text-muted-foreground">No tokens configured.</p>
              )}
              {tokens?.map((t) => (
                <div
                  key={t.instrumentId || t.label}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <TokenLogo label={t.label} size={22} />
                    <span className="min-w-0">
                      <span className="mono block truncate text-sm font-medium text-text">
                        {t.label}
                      </span>
                      {t.decimals >= 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t.decimals} decimals
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => getTestTokens(t.label)}
                    disabled={!!busy}
                    className="shrink-0 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                  >
                    {busy === t.label ? "Requesting…" : "Get test tokens"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
