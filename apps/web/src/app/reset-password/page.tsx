"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ApiError, completePasswordReset } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@nova/shared";
import { AuthPageShell } from "@/components/AuthPageShell";

function CompletePasswordResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await completePasswordReset(token, password);
      setSuccess(true);
      setTimeout(() => router.replace("/login"), 2000);
    } catch (err) {
      // password_* (blocklisted/too-short/too-long from the policy service)
      // and validation_failed (the request-schema length check, in case the
      // input's own minLength/maxLength is ever bypassed) both mean "the
      // password itself was rejected" — never mislabel that as a dead link.
      if (err instanceof ApiError && (err.code.startsWith("password_") || err.code === "validation_failed")) {
        setError("This password does not meet the requirements below.");
      } else {
        setError("This reset link is invalid, expired, or has already been used.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="alert alert-error" role="alert">
        This reset link is missing its token.
      </div>
    );
  }

  if (success) {
    return (
      <div className="alert alert-success" role="status">
        Password updated. All previous sessions were signed out. Redirecting to sign in…
      </div>
    );
  }

  return (
    <div className="card stack">
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Choose a new password</h1>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
      <Link href="/login">Back to sign in</Link>
    </div>
  );
}

export default function CompletePasswordResetPage() {
  return (
    <AuthPageShell>
      <Suspense fallback={<p>Loading…</p>}>
        <CompletePasswordResetForm />
      </Suspense>
    </AuthPageShell>
  );
}
