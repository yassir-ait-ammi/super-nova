import { z } from "zod";

export const BUSINESS_SCOPE_TYPES = ["RESTAURANT", "PROPERTY_DEVELOPMENT", "CONSTRUCTION", "EVENT"] as const;

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(160),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(160),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const createBusinessScopeSchema = z.object({
  companyId: z.string().uuid(),
  type: z.enum(BUSINESS_SCOPE_TYPES),
  name: z.string().trim().min(2).max(160),
  externalId: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  responsiblePerson: z.string().trim().max(160).optional(),
});
export type CreateBusinessScopeInput = z.infer<typeof createBusinessScopeSchema>;

export const checkBusinessScopeDuplicateSchema = z.object({
  companyId: z.string().uuid(),
  type: z.enum(BUSINESS_SCOPE_TYPES),
  name: z.string().trim().min(2).max(160),
  externalId: z.string().trim().max(120).optional(),
});
export type CheckBusinessScopeDuplicateInput = z.infer<typeof checkBusinessScopeDuplicateSchema>;

export const directoryQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
