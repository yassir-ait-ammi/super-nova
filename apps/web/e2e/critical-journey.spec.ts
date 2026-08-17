import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL!;
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD!;
const OWNER_PASSWORD = "Owner-Chooses-A-New-Password-01";

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function extractInvitationToken(request: import("@playwright/test").APIRequestContext, email: string) {
  const res = await request.get(`/api/test-support/emails/latest?to=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const match = (body.text as string).match(/token=([^\s&"']+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
}

test.describe("Critical journey: bootstrap admin → provision org → invite → activate → login/logout", () => {
  test("full happy path plus invitation replay refusal", async ({ page, request }) => {
    // 1. Platform Administrator signs in with first-party credentials.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);
    await expect(page.getByText("Platform Administration")).toBeVisible();

    // 2. Provision an Organization; this sends a real invitation email
    // through the same Resend-backed port (captured by the deterministic
    // test adapter here instead of a live mailbox).
    const orgName = unique("Playwright Org");
    const ownerEmail = `${unique("owner")}@nova-e2e.local`;
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Initial owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(new RegExp(`Organization "${orgName}" created`))).toBeVisible();
    const orgRow = page.getByRole("row").filter({ hasText: orgName });
    await expect(orgRow).toBeVisible();
    await expect(orgRow.getByText("PROVISIONING")).toBeVisible();

    // 3. Recover the invitation link the same way a human would from their
    // inbox — via the recorded content of the real transactional-email port.
    const token = await extractInvitationToken(request, ownerEmail);

    // 4. The invited owner activates their account by choosing a password.
    await page.goto(`/invitations/accept?token=${encodeURIComponent(token)}`);
    await page.getByLabel("New password").fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Activate account" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);
    await expect(page.getByText(orgName).first()).toBeVisible();

    // 5. The Organization is now ACTIVE with exactly one owner — verify from
    // the platform admin's perspective too.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByPlaceholder("Search by name…").fill(orgName);
    await page.getByRole("button", { name: "Search" }).click();
    const searchedRow = page.getByRole("row").filter({ hasText: orgName });
    await expect(searchedRow.getByText("ACTIVE")).toBeVisible();

    // 6. The same invitation cannot be replayed — direct API call, exactly
    // the shape a hidden/removed UI action would have used.
    const replay = await request.post("/api/invitations/accept", {
      data: { token, password: "Some-Other-Password-Entirely-0" },
    });
    expect(replay.status()).toBe(404);
    const replayBody = await replay.json();
    expect(replayBody.code).toBe("invalid_or_expired_invitation");

    // 7. The owner can log out and log back in with the password they chose.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);
  });

  test("neutral password-reset journey", async ({ page, request }) => {
    // Set up a known account by provisioning + accepting an invitation first.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);

    const ownerEmail = `${unique("reset-owner")}@nova-e2e.local`;
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(unique("Reset Org"));
    await page.getByLabel("Initial owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(/created and initial-owner invitation sent/)).toBeVisible();
    const inviteToken = await extractInvitationToken(request, ownerEmail);
    const acceptRes = await request.post("/api/invitations/accept", {
      data: { token: inviteToken, password: "First-Chosen-Password-000000" },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // Request the reset — neutral confirmation regardless of outcome.
    await page.goto("/reset-password/request");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/password reset link has been sent/)).toBeVisible();

    const resetToken = await (async () => {
      const res = await request.get(`/api/test-support/emails/latest?to=${encodeURIComponent(ownerEmail)}`);
      const body = await res.json();
      const match = (body.text as string).match(/token=([^\s&"']+)/);
      return decodeURIComponent(match![1]);
    })();

    const newPassword = "Brand-New-Reset-Password-00000";
    await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Confirm password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText(/Password updated/)).toBeVisible();

    await page.waitForURL(/\/login$/, { timeout: 5000 });
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(newPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);
  });
});
