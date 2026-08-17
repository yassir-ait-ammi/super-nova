/**
 * Explicit capabilities a `User` membership can be granted. `Administrator`
 * memberships never consult this list — they have full Organization access
 * by profile, per FR-003/FR-089 ("exactly two Organization profiles").
 * Permission presets are not additional roles: they are named starting
 * bundles that resolve to exactly these grants and remain editable before
 * confirmation (FR-116).
 */
export const CAPABILITIES = [
  "VIEW_COMPANIES",
  "VIEW_BUSINESS_SCOPES",
  "MANAGE_COMPANIES",
  "MANAGE_BUSINESS_SCOPES",
  "MANAGE_COLLABORATORS",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface PermissionPreset {
  key: string;
  label: string;
  description: string;
  capabilities: Capability[];
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    key: "READ_ONLY",
    label: "Read-only",
    description: "Can view authorized Companies and Business Scopes only.",
    capabilities: ["VIEW_COMPANIES", "VIEW_BUSINESS_SCOPES"],
  },
  {
    key: "COMPANY_MANAGER",
    label: "Company manager",
    description: "Can create and edit Companies and Business Scopes within their grants.",
    capabilities: ["VIEW_COMPANIES", "VIEW_BUSINESS_SCOPES", "MANAGE_COMPANIES", "MANAGE_BUSINESS_SCOPES"],
  },
  {
    key: "COLLABORATOR_MANAGER",
    label: "Collaborator manager",
    description: "Can invite, suspend, reactivate, and remove other collaborators.",
    capabilities: ["VIEW_COMPANIES", "VIEW_BUSINESS_SCOPES", "MANAGE_COLLABORATORS"],
  },
  {
    key: "FULL_USER",
    label: "Full collaborator",
    description: "Every capability available to a User profile.",
    capabilities: [...CAPABILITIES],
  },
];

export function presetCapabilities(presetKey: string): Capability[] {
  const preset = PERMISSION_PRESETS.find((p) => p.key === presetKey);
  return preset ? [...preset.capabilities] : [];
}
