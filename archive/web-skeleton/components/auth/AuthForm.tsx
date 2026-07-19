"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { safeInternalPath } from "@/lib/safe-redirect.ts";

type Mode = "sign-in" | "sign-up";

type AuthFormProps = {
  mode: Mode;
  /** Optional error from server redirect (e.g. local account failure) */
  initialError?: string | null;
};

export function AuthForm({ mode, initialError = null }: AuthFormProps) {
  const searchParams = useSearchParams();
  const from = safeInternalPath(searchParams.get("from"));
  const switchHref =
    mode === "sign-up"
      ? `/sign-in?from=${encodeURIComponent(from)}`
      : `/sign-up?from=${encodeURIComponent(from)}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const [localPending, setLocalPending] = useState(false);

  const isSignUp = mode === "sign-up";
  const endpoint = isSignUp ? "/api/auth/sign-up" : "/api/auth/sign-in";
  const submitLabel = isSignUp ? "Sign up" : "Sign in";
  const busy = pending || localPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const body: Record<string, string> = { email, password };
      if (isSignUp && name.trim()) body.name = name.trim();

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setPending(false);
        return;
      }
      window.location.assign(from);
    } catch {
      setError("Network error — is the dev server running?");
      setPending(false);
    }
  }

  return (
    <div className="auth-form-stack">
      {/*
        Plain HTML form POST — works even when client JS fails to hydrate.
        /api/auth/local sets cookies and 303-redirects to safe `from` (default /home).
      */}
      <div className="auth-local">
        <form
          action="/api/auth/local"
          method="post"
          onSubmit={() => {
            setError(null);
            setLocalPending(true);
          }}
        >
          <input type="hidden" name="from" value={from} />
          <button
            type="submit"
            className="auth-submit auth-submit--local"
            disabled={busy}
            style={{ width: "100%" }}
          >
            {localPending ? "Starting…" : "Continue with local account"}
          </button>
        </form>
        <p className="auth-local__hint muted">
          No email or password — stays on this machine. Best for personal use.
        </p>
      </div>

      <div className="auth-divider" role="separator">
        <span>or use email</span>
      </div>

      <form method="post" onSubmit={onSubmit} className="auth-form">
        {isSignUp ? (
          <label className="auth-field">
            <span>Name</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              disabled={busy}
            />
          </label>
        ) : null}

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button type="submit" className="auth-submit" disabled={busy}>
          {pending ? "Please wait…" : submitLabel}
        </button>

        <p className="auth-switch muted">
          {isSignUp ? (
            <>
              Already have an account? <Link href={switchHref}>Sign in</Link>
            </>
          ) : (
            <>
              Need an account? <Link href={switchHref}>Sign up</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
