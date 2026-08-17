import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).default(4000),
  WEB_ORIGIN: z.string().url(),
  APP_DATABASE_URL: z.string().min(1),
  SESSION_CSRF_SECRET: z.string().min(32, "SESSION_CSRF_SECRET must be at least 32 characters"),
  EMAIL_PAYLOAD_ENC_KEY: z.string().refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "EMAIL_PAYLOAD_ENC_KEY must be a base64-encoded 32-byte key"
  ),
  EMAIL_ADAPTER: z.enum(["resend", "gmail", "recording"]).default("recording"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_SENDER_EMAIL: z.string().email().optional(),
  // Gmail SMTP alternative to Resend — no domain/DNS verification needed,
  // just a Google account with an App Password. See gmail-email.adapter.ts.
  GMAIL_USER: z.string().email().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GMAIL_SENDER_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  if (parsed.data.EMAIL_ADAPTER === "resend") {
    if (!parsed.data.RESEND_API_KEY || !parsed.data.RESEND_SENDER_EMAIL) {
      throw new Error("EMAIL_ADAPTER=resend requires RESEND_API_KEY and RESEND_SENDER_EMAIL");
    }
  }
  if (parsed.data.EMAIL_ADAPTER === "gmail") {
    if (!parsed.data.GMAIL_USER || !parsed.data.GMAIL_APP_PASSWORD) {
      throw new Error("EMAIL_ADAPTER=gmail requires GMAIL_USER and GMAIL_APP_PASSWORD");
    }
  }
  return parsed.data;
}
