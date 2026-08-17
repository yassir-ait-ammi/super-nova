"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { acceptExistingInvitation, ApiError, login } from "@/lib/api-client";
import { AuthPageShell } from "@/components/AuthPageShell";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnToken = searchParams.get("returnToken");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      if (returnToken) {
        // Completes the pending collaborator-invitation acceptance for the
        // identity that just authenticated (SEC-09's "existing identity
        // authenticates first" step).
        await acceptExistingInvitation(returnToken).catch(() => undefined);
      }
      router.replace("/");
    } catch (err) {
      // Neutral message regardless of cause (SEC-16) — never distinguishes
      // "wrong password" from "no such account" from "account unavailable".
      setError(err instanceof ApiError ? "Incorrect email or password." : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card stack">
      <div>
        <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Sign in to NOVA</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
          Platform Administrators and Organization members sign in here.
        </p>
      </div>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="stack" style={{ gap: 6 }}>
        <Link href="/reset-password/request">Forgot your password?</Link>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
          New to NOVA? <Link href="/register">Create your Organization</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthPageShell>
      <Suspense fallback={<p>Loading…</p>}>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
