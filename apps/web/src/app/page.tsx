"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { me } from "@/lib/api-client";
import { Logo } from "@/components/Logo";
import { BuildingIcon, ShieldCheckIcon, UsersIcon } from "@/components/icons";

type SessionState = "checking" | "authenticated" | "guest";

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<SessionState>("checking");

  useEffect(() => {
    me()
      .then((user) => {
        setState("authenticated");
        router.replace(user.isPlatformAdministrator ? "/platform-admin" : "/org/companies");
      })
      .catch(() => setState("guest"));
  }, [router]);

  if (state !== "guest") {
    return (
      <main className="container flex items-center justify-center">
        <p aria-live="polite">Loading NOVA…</p>
      </main>
    );
  }

  return (
    <main className="landing">
      <div className="landing-nav">
        <span className="landing-nav-brand">
          <Logo size={30} />
          NOVA
        </span>
        <nav className="landing-nav-links" aria-label="Account">
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create your Organization</Link>
        </nav>
      </div>

      <section className="landing-hero">
        <p className="page-eyebrow">SaaS foundation &amp; collaborative administration</p>
        <h1>One workspace for every Organization, Company, and Business Scope you run.</h1>
        <p>
          NOVA gives each Organization its own isolated workspace, precise collaborator permissions down to a
          single Business Scope, and a full audit trail &mdash; so owners stay in control as their team grows.
        </p>
        <div className="landing-cta-row">
          <button className="lg" onClick={() => router.push("/register")}>
            Create your Organization
          </button>
          <button className="secondary lg" onClick={() => router.push("/login")}>
            Sign in
          </button>
        </div>
        <p className="landing-note">Free to start. No credit card, no waiting on an invite.</p>
      </section>

      <section className="landing-features" aria-label="What NOVA gives you">
        <div className="landing-feature-card">
          <div className="landing-feature-icon">
            <BuildingIcon size={20} />
          </div>
          <h3>Companies &amp; Business Scopes</h3>
          <p>
            Model your Organization the way you actually run it &mdash; Companies split into Restaurant,
            Property, Construction, or Event scopes, each with its own identity.
          </p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">
            <UsersIcon size={20} />
          </div>
          <h3>Collaborators, precisely scoped</h3>
          <p>
            Invite collaborators with editable permission presets, grant access to exactly the Companies or
            scopes they need, suspend or promote them, and transfer ownership without ever losing control.
          </p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">
            <ShieldCheckIcon size={20} />
          </div>
          <h3>Isolated by design</h3>
          <p>
            Every Organization&apos;s data is enforced apart at the database layer &mdash; not just the
            application &mdash; with a full evidence trail behind every sensitive action.
          </p>
        </div>
      </section>
    </main>
  );
}
