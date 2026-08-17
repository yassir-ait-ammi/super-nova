import { z } from "zod";
import { emailSchema } from "./auth";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  ownerEmail: emailSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const organizationDirectoryQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrganizationDirectoryQuery = z.infer<typeof organizationDirectoryQuerySchema>;

export const updateCommercialStatusSchema = z.object({
  commercialStatus: z.enum(["DEMO", "PILOT", "ACTIVE"]),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateCommercialStatusInput = z.infer<typeof updateCommercialStatusSchema>;

export const organizationLifecycleActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type OrganizationLifecycleActionInput = z.infer<typeof organizationLifecycleActionSchema>;
