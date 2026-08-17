"use client";

import { createContext, useContext } from "react";
import type { MyOrganization } from "./api-client";

export const OrgContext = createContext<MyOrganization | null>(null);

export function useOrg(): MyOrganization {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg used outside the /org layout");
  return ctx;
}
