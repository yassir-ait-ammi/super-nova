import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./Logo";

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="container" style={{ maxWidth: 420, marginTop: 64 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text)", textDecoration: "none" }}
        >
          <Logo size={30} />
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "0.04em" }}>NOVA</span>
        </Link>
      </div>
      {children}
    </main>
  );
}
