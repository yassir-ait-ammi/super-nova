import { z } from "zod";
import { CAPABILITIES } from "../capabilities";
import { emailSchema } from "./auth";

const capabilityEnum = z.enum(CAPABILITIES as unknown as [string, ...string[]]);

export const scopeGrantInputSchema = z
  .object({
    companyId: z.string().uuid().optional(),
    businessScopeId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.companyId) || Boolean(v.businessScopeId), {
    message: "Either companyId or businessScopeId is required",
  });
export type ScopeGrantInput = z.infer<typeof scopeGrantInputSchema>;

export const inviteCollaboratorSchema = z.object({
  email: emailSchema,
  presetKey: z.string().trim().max(60).optional(),
  capabilities: z.array(capabilityEnum).max(CAPABILITIES.length).default([]),
  scopeGrants: z.array(scopeGrantInputSchema).max(200).default([]),
});
export type InviteCollaboratorInput = z.infer<typeof inviteCollaboratorSchema>;

export const updatePermissionsSchema = z.object({
  presetKey: z.string().trim().max(60).optional(),
  capabilities: z.array(capabilityEnum).max(CAPABILITIES.length),
  scopeGrants: z.array(scopeGrantInputSchema).max(200),
});
export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;

export const acceptExistingInvitationSchema = z.object({
  token: z.string().min(20).max(512),
});
export type AcceptExistingInvitationInput = z.infer<typeof acceptExistingInvitationSchema>;

export const membershipActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type MembershipActionInput = z.infer<typeof membershipActionSchema>;

export const ownershipTransferProposeSchema = z.object({
  successorMembershipId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type OwnershipTransferProposeInput = z.infer<typeof ownershipTransferProposeSchema>;
