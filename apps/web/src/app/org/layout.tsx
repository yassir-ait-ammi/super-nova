"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AccessUnavailable } from "@/components/AccessUnavailable";
import { BuildingIcon, UsersIcon } from "@/components/icons";
import { getMyOrganization, logout, MyOrganization } from "@/lib/api-client";
import { OrgContext } from "@/lib/org-context";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [org, setOrg] = useState<MyOrganization | null>(null);
  const [checked, setChecked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    getMyOrganization()
      .then(setOrg)
      .catch(() => setUnavailable(true))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <main className="container flex items-center justify-center">
        <p aria-live="polite">Loading…</p>
      </main>
    );
  }

  if (unavailable || !org) {
    return <AccessUnavailable />;
  }

  return (
    <OrgContext.Provider value={org}>
      <AppShell
        navItems={[
          { href: "/org/companies", label: "Companies & Scopes", icon: <BuildingIcon /> },
          { href: "/org/members", label: "Users & Permissions", icon: <UsersIcon /> },
        ]}
        contextLabel={org.organizationName}
        userLabel={org.isOwner ? "Owner" : org.profile === "ADMINISTRATOR" ? "Administrator" : "User"}
        onSignOut={() => {
          void logout().then(() => router.replace("/login"));
        }}
      >
        {children}
      </AppShell>
    </OrgContext.Provider>
  );
}
