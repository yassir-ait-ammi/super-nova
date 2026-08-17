"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PASSWORD_MIN_LENGTH } from "@nova/shared";
import { ApiError, register } from "@/lib/api-client";
import { AuthPageShell } from "@/components/AuthPageShell";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "organization_name_taken") {
      return "An Organization with this name already exists. Try a more specific name.";
    }
    if (err.code === "email_already_registered") {
      return "An account already exists for this email. Try signing in instead.";
    }
    if (err.code.startsWith("password_") || err.code === "validation_failed") {
      return "This password does not meet the requirements below.";
    }
  }
  return "Something went wrong. Please try again.";
}

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      await register(organizationName, email, password);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageShell>
      <div className="card stack">
        <div>
          <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Create your Organization</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
            You&apos;ll become the owner of a brand-new Organization, active immediately &mdash; no invitation
            needed.
          </p>
        </div>
        <form className="stack" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="organizationName">Organization name</label>
            <input
              id="organizationName"
              name="organizationName"
              type="text"
              autoComplete="organization"
              minLength={2}
              maxLength={160}
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Acme Hospitality Group"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Your email</label>
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
              name="confirm"
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
            {submitting ? "Creating your Organization…" : "Create Organization"}
          </button>
        </form>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
