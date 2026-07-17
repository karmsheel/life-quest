"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Mode = "sign-in" | "sign-up";

type AuthFormProps = {
  mode: Mode;
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "sign-up";
  const endpoint = isSignUp ? "/api/auth/sign-up" : "/api/auth/sign-in";
  const submitLabel = isSignUp ? "Sign up" : "Sign in";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const body: Record<string, string> = { email, password };
      if (isSignUp && name.trim()) body.name = name.trim();

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/home");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
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
        />
      </label>

      {error ? <p className="auth-error">{error}</p> : null}

      <button type="submit" className="auth-submit" disabled={pending}>
        {pending ? "Please wait…" : submitLabel}
      </button>

      <p className="auth-switch muted">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in">Sign in</Link>
          </>
        ) : (
          <>
            Need an account? <Link href="/sign-up">Sign up</Link>
          </>
        )}
      </p>
    </form>
  );
}
