"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ApiError } from "@/lib/api";

// Error toasts surface {stage, errorId} from the backend so failures are
// debuggable on camera (08 §1).
export interface Toast {
  id: number;
  kind: "error" | "info" | "success";
  message: string;
  stage?: string;
  errorId?: string;
}

interface ToastCtx {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  pushError: (err: unknown, fallback?: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = seq++;
      setToasts((prev) => [...prev, { ...t, id }]);
      // auto-dismiss non-error toasts
      if (t.kind !== "error") {
        setTimeout(() => dismiss(id), 4000);
      }
    },
    [dismiss],
  );

  const pushError = useCallback(
    (err: unknown, fallback = "Something went wrong") => {
      if (err instanceof ApiError) {
        push({
          kind: "error",
          message: err.detail || err.message || fallback,
          stage: err.stage,
          errorId: err.errorId,
        });
      } else if (err instanceof Error) {
        push({ kind: "error", message: err.message || fallback });
      } else {
        push({ kind: "error", message: fallback });
      }
    },
    [push],
  );

  return (
    <Ctx.Provider value={{ toasts, push, pushError, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: number) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`toast-in rounded-lg border px-4 py-3 shadow-lg ${
            t.kind === "error"
              ? "border-slash/60 bg-surface-2"
              : t.kind === "success"
                ? "border-refund/60 bg-surface-2"
                : "border-info/60 bg-surface-2"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-text">{t.message}</p>
              {(t.stage || t.errorId) && (
                <p className="mono mt-1 text-xs text-muted">
                  {t.stage ? `stage: ${t.stage}` : ""}
                  {t.stage && t.errorId ? " · " : ""}
                  {t.errorId ? `errorId: ${t.errorId}` : ""}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-muted hover:text-text"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
