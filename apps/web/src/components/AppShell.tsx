"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { BuildingIcon, UserIcon } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export function AppShell({
  navItems,
  contextLabel,
  userLabel,
  onSignOut,
  children,
}: {
  navItems: NavItem[];
  contextLabel: string;
  userLabel: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <a href="#shell-main-content" className="sr-only-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href={navItems[0]?.href ?? "#"} className="sidebar-brand" aria-label="NOVA">
          <Logo size={72} />
          <span className="sidebar-brand-name">NOVA</span>
        </Link>
        <nav className="sidebar-nav" aria-label="Main">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className="sidebar-link" aria-current={active ? "page" : undefined}>
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="shell-main">
        <div className="shell-topbar">
          <span className="context-chip">
            <BuildingIcon />
            {contextLabel}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span className="user-chip">
              <UserIcon size={18} />
              {userLabel}
            </span>
            <button className="secondary" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
        <main id="shell-main-content" className="shell-content stack">
          {children}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Main">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className="bottom-nav-link" aria-current={active ? "page" : undefined}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
