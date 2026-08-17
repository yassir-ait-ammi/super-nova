"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BuildingIcon } from "@/components/icons";
import { logout, me } from "@/lib/api-client";
import { AccessUnavailable } from "@/components/AccessUnavailable";

export default function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    me()
      .then((user) => {
        if (user.isPlatformAdministrator) {
          setAuthorized(true);
        }
      })
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <main className="container">
        <p className="flex items-center justify-center" aria-live="polite">Loading…</p>
      </main>
    );
  }

  if (!authorized) {
    return <AccessUnavailable />;
  }

  return (
    <AppShell
      navItems={[{ href: "/platform-admin", label: "Organizations", icon: <BuildingIcon /> }]}
      contextLabel="Platform Administration"
      userLabel={"Admin"}
      onSignOut={() => {
        void logout().then(() => router.replace("/login"));
      }}
    >
      {children}
    </AppShell>
  );
}
