"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { AppConfig, DevAccount } from "@/lib/types";
import { useSession } from "./SessionProvider";
import { useToast } from "./ToastProvider";

// AuthForms (08 §2 / component inventory): brand-styled /login and /signup.
// Gold primary button, ink surfaces. Signup shows the on-chain copy line.
// Errors surface as {stage, errorId} toasts. Login carries the DEV quick-login
// strip when the backend reports it enabled.

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold";

// Seeded demo accounts for the DEV quick-login strip (05 §2: Organizer/Alice/
// Bob/Charlie). Only the email is sent to POST /api/auth/dev-login.
const DEV_ACCOUNTS: DevAccount[] = [
  { email: "organizer@showorsow.dev", name: "Organizer", role: "organizer" },
  { email: "alice@showorsow.dev", name: "Alice", role: "attendee" },
  { email: "bob@showorsow.dev", name: "Bob", role: "attendee" },
  { email: "charlie@showorsow.dev", name: "Charlie", role: "attendee" },
];

export function AuthForms({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { pushError } = useToast();
  const { revalidateAll, isAuthenticated } = useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";

  // Already signed in → bounce to the app (e.g. back button onto /login).
  useEffect(() => {
    if (isAuthenticated) router.replace("/events");
  }, [isAuthenticated, router]);

  async function finishAuth() {
    await revalidateAll();
    router.replace("/events");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isSignup) {
        await api.register({
          name: name.trim(),
          email: email.trim(),
          password,
        });
      } else {
        await api.login({ email: email.trim(), password });
      }
      await finishAuth();
    } catch (err) {
      pushError(err, isSignup ? "Could not create account" : "Could not sign in");
      setSubmitting(false);
    }
  }

  const valid =
    email.trim() && password && (!isSignup || name.trim());

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Image
          src="/brand/logo-mark.png"
          alt=""
          width={40}
          height={40}
          className="rounded-lg"
          priority
        />
        <div>
          <h1 className="text-xl font-semibold">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignup
              ? "Stake to RSVP, get refunded when you show up."
              : "Sign in to your ShowOrSow account."}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {isSignup && (
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="name"
              required
            />
          </Field>
        )}

        <Field label="Email">
          <input
            type="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
        </Field>

        {isSignup && (
          <p className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2.5 text-xs text-muted-foreground">
            Creating your account also creates your private Canton identity
            (party).
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || submitting}
          className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-50"
        >
          {submitting
            ? isSignup
              ? "Creating account…"
              : "Signing in…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-gold hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to ShowOrSow?{" "}
            <Link href="/signup" className="text-gold hover:underline">
              Sign up
            </Link>
          </>
        )}
      </p>

      {!isSignup && <DevQuickLogin onDone={finishAuth} />}
    </div>
  );
}

// DEV quick-login strip (08 §2): one-click seeded logins, shown only when the
// backend reports DEV_QUICK_LOGIN enabled. We probe GET /api/config (documented
// choice — /api/session 401s pre-login so the flag can't ride on it); the strip
// stays hidden if the probe is absent or errors.
function DevQuickLogin({ onDone }: { onDone: () => Promise<void> }) {
  const { pushError } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useSWR<AppConfig>("/api/config", {
    // A missing endpoint (404) must not spam retries or break the page.
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });

  if (!data?.devQuickLogin) return null;

  async function quickLogin(acct: DevAccount) {
    if (busy) return;
    setBusy(acct.email);
    try {
      await api.devLogin(acct.email);
      await onDone();
    } catch (err) {
      pushError(err, "Quick login failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="rounded border border-info/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-info">
          dev
        </span>
        <p className="text-xs text-muted-foreground">
          Demo accounts — one-click login for the walkthrough.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DEV_ACCOUNTS.map((acct) => (
          <button
            key={acct.email}
            onClick={() => quickLogin(acct)}
            disabled={!!busy}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-sm hover:border-gold/50 disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-text">
                {acct.name}
              </span>
              {acct.role && (
                <span className="block truncate text-[11px] text-faint">
                  {acct.role}
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-gold">
              {busy === acct.email ? "…" : "→"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
