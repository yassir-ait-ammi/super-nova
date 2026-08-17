"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { LockAlertIcon, UserIcon } from "./icons";
import { logout } from "@/lib/api-client";

/**
 * Consequence-first "your access is unavailable" state (matches
 * ui/screens/user-suspension.html / assessment-docs/ux/core/user-suspension-mobile-reference.png).
 * Shown whenever a session that appeared valid can no longer reach
 * protected data — suspended, terminally disabled, or a stale/expired
 * session — without trying to distinguish which for the viewer (that
 * distinction isn't meaningful to them, and guessing at it risks stating
 * something the server hasn't confirmed).
 */
export function AccessUnavailable() {
  return (
    <div className="phone">
      <header className="phone-top">
        <Link href="/" className="brand-inline">
          <Logo size={34} />
          NOVA
        </Link>
        <span className="avatar-btn" aria-hidden="true">
          <UserIcon size={18} />
        </span>
      </header>

      <main className="suspend-body">
        <div className="lock" aria-hidden="true">
          <LockAlertIcon size={52} />
        </div>
        <span className="badge badge-danger">Access unavailable</span>
        <h1>Your access is currently unavailable</h1>
        <p className="lede">
          You cannot view this Organization&apos;s data right now. This can happen if your access was suspended,
          your session expired, or you&apos;re not a member of this Organization.
        </p>
        <div className="rule" />
        <div className="help">
          <span className="bubble-ico">
            <UserIcon size={16} />
          </span>
          Contact an Administrator of your Organization if you believe this is a mistake.
        </div>
        <button
          className="lg"
          style={{ minWidth: 280 }}
          onClick={() => {
            void logout().then(() => {
              window.location.href = "/login";
            });
          }}
        >
          Sign out
        </button>
        <p style={{ marginTop: 16 }}>
          <Link href="/login" className="linkish">
            Back to sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
