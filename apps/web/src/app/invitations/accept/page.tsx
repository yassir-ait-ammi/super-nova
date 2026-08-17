"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptExistingInvitation, acceptInvitation, ApiError } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@nova/shared";
import { AuthPageShell } from "@/components/AuthPageShell";

function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRequiresLogin(false);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await acceptInvitation(token, password);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "invitation_requires_login") {
        // Maybe they're already signed in as that identity in this browser.
        try {
          await acceptExistingInvitation(token);
          router.replace("/");
          return;
        } catch {
          setRequiresLogin(true);
          setError("An account already exists for this email. Please sign in, then return to this link.");
        }
      } else if (err instanceof ApiError && (err.code.startsWith("password_") || err.code === "validation_failed")) {
        setError("This password does not meet the requirements below.");
      } else {
        setError("This invitation link is invalid, expired, or has already been used.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="alert alert-error" role="alert">
        This invitation link is missing its token.
      </div>
    );
  }

  return (
    <div className="card stack">
      <div>
        <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Activate your account</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
          Choose a password to activate your NOVA account and accept your invitation.
        </p>
      </div>
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
            aria-describedby="password-help"
          />
          <span id="password-help" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            At least {PASSWORD_MIN_LENGTH} characters. No specific character mix required.
          </span>
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
          {submitting ? "Activating…" : "Activate account"}
        </button>
      </form>
      {requiresLogin && (
        <Link href={`/login?returnToken=${encodeURIComponent(token)}`}>Sign in to accept this invitation</Link>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <AuthPageShell>
      <Suspense fallback={<p>Loading…</p>}>
        <AcceptInvitationForm />
      </Suspense>
    </AuthPageShell>
  );
}
