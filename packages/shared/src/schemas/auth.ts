import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../constants";

/** Email is normalized (trimmed + lowercased) server-side; client sends the raw value. */
export const emailSchema = z.string().trim().min(3).max(320).email();

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Self-service sign-up: a brand-new Organization name, chosen by its future owner. */
export const organizationNameSchema = z.string().trim().min(2).max(160);

export const registerSchema = z.object({
  organizationName: organizationNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(512),
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const completePasswordResetSchema = z.object({
  token: z.string().min(20).max(512),
  password: passwordSchema,
});
export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;
