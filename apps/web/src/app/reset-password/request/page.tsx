"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api-client";
import { AuthPageShell } from "@/components/AuthPageShell";

export default function RequestPasswordResetPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
    } finally {
      // Always show the same neutral confirmation (SEC-16) — never reveals
      // whether the email exists.
      setSubmitted(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthPageShell>
      <div className="card stack">
        <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Reset your password</h1>
        {submitted ? (
          <div className="alert alert-success" role="status">
            If that email is registered, a password reset link has been sent to it. The link expires in 30 minutes
            and can be used once.
          </div>
        ) : (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        <Link href="/login">Back to sign in</Link>
      </div>
    </AuthPageShell>
  );
}
