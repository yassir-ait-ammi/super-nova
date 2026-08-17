import { z } from "zod";

/**
 * SEC-17 allowlist: exactly the three required transactional templates, each
 * with a fixed version and a schema-validated, non-secret variable set. No
 * caller path can substitute arbitrary markup, a different sender, or an
 * arbitrary link origin — `renderLink` always composes the link from the
 * server's own WEB_ORIGIN plus a fixed path for that template.
 */
export const EMAIL_TEMPLATE_KEYS = [
  "INITIAL_OWNER_INVITE",
  "COLLABORATOR_INVITE",
  "PASSWORD_RESET",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

const initialOwnerInviteVariables = z.object({
  organizationName: z.string().min(1).max(160),
  expiresAt: z.string(), // ISO 8601, rendered as-is (no locale/user input mixed in)
});

const collaboratorInviteVariables = z.object({
  organizationName: z.string().min(1).max(160),
  inviterLabel: z.string().min(1).max(160),
  expiresAt: z.string(),
});

const passwordResetVariables = z.object({
  expiresAt: z.string(),
});

export interface TemplateDefinition<V> {
  version: number;
  linkPath: (token: string) => string;
  variablesSchema: z.ZodType<V>;
  render: (vars: V, link: string) => { subject: string; html: string; text: string };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(preheader: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px;background:#0b0e14;color:#e6e9ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#131722;border-radius:12px;padding:32px;">
<tr><td>${bodyHtml}<p style="margin-top:32px;font-size:12px;color:#8b93a7;">NOVA — synthetic assessment product. If you did not expect this email, you can ignore it.</p></td></tr>
</table>
</body></html>`;
}

export type TemplateVariablesFor<K extends EmailTemplateKey> = K extends "INITIAL_OWNER_INVITE"
  ? z.infer<typeof initialOwnerInviteVariables>
  : K extends "COLLABORATOR_INVITE"
    ? z.infer<typeof collaboratorInviteVariables>
    : z.infer<typeof passwordResetVariables>;

export const EMAIL_TEMPLATES: {
  INITIAL_OWNER_INVITE: TemplateDefinition<z.infer<typeof initialOwnerInviteVariables>>;
  COLLABORATOR_INVITE: TemplateDefinition<z.infer<typeof collaboratorInviteVariables>>;
  PASSWORD_RESET: TemplateDefinition<z.infer<typeof passwordResetVariables>>;
} = {
  INITIAL_OWNER_INVITE: {
    version: 1,
    linkPath: (token) => `/invitations/accept?token=${encodeURIComponent(token)}`,
    variablesSchema: initialOwnerInviteVariables,
    render: (vars, link) => {
      const orgName = escapeHtml(vars.organizationName);
      return {
        subject: `You're invited to activate ${vars.organizationName} on NOVA`,
        text: `You have been invited to activate the Organization "${vars.organizationName}" on NOVA as its initial owner. Activate your account: ${link}\nThis link expires on ${vars.expiresAt} and can only be used once.`,
        html: layout(
          `Activate ${vars.organizationName} on NOVA`,
          `<h1 style="font-size:20px;margin:0 0 16px;">Activate ${orgName}</h1>
           <p style="font-size:14px;line-height:1.6;">You've been invited to activate the Organization <strong>${orgName}</strong> on NOVA as its initial owner.</p>
           <p style="margin:24px 0;"><a href="${link}" style="background:#4f7cff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Activate account</a></p>
           <p style="font-size:12px;color:#8b93a7;">This link expires on ${escapeHtml(vars.expiresAt)} and can be used once.</p>`
        ),
      };
    },
  },
  COLLABORATOR_INVITE: {
    version: 1,
    linkPath: (token) => `/invitations/accept?token=${encodeURIComponent(token)}`,
    variablesSchema: collaboratorInviteVariables,
    render: (vars, link) => {
      const orgName = escapeHtml(vars.organizationName);
      const inviter = escapeHtml(vars.inviterLabel);
      return {
        subject: `${vars.inviterLabel} invited you to join ${vars.organizationName} on NOVA`,
        text: `${vars.inviterLabel} invited you to join "${vars.organizationName}" on NOVA. Accept your invitation: ${link}\nThis link expires on ${vars.expiresAt} and can only be used once.`,
        html: layout(
          `Join ${vars.organizationName} on NOVA`,
          `<h1 style="font-size:20px;margin:0 0 16px;">Join ${orgName}</h1>
           <p style="font-size:14px;line-height:1.6;"><strong>${inviter}</strong> invited you to collaborate on <strong>${orgName}</strong> in NOVA.</p>
           <p style="margin:24px 0;"><a href="${link}" style="background:#4f7cff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invitation</a></p>
           <p style="font-size:12px;color:#8b93a7;">This link expires on ${escapeHtml(vars.expiresAt)} and can be used once.</p>`
        ),
      };
    },
  },
  PASSWORD_RESET: {
    version: 1,
    linkPath: (token) => `/reset-password?token=${encodeURIComponent(token)}`,
    variablesSchema: passwordResetVariables,
    render: (vars, link) => ({
      subject: "Reset your NOVA password",
      text: `A password reset was requested for your NOVA account. Reset it here: ${link}\nThis link expires on ${vars.expiresAt} and can only be used once. If you did not request this, you can ignore this email.`,
      html: layout(
        "Reset your NOVA password",
        `<h1 style="font-size:20px;margin:0 0 16px;">Reset your password</h1>
         <p style="font-size:14px;line-height:1.6;">A password reset was requested for your NOVA account.</p>
         <p style="margin:24px 0;"><a href="${link}" style="background:#4f7cff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a></p>
         <p style="font-size:12px;color:#8b93a7;">This link expires on ${escapeHtml(vars.expiresAt)} and can be used once. If you did not request this, you can ignore this email.</p>`
      ),
    }),
  },
};
