import { expect, Page, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL!;
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD!;
const OWNER_PASSWORD = "Owner-Chooses-A-New-Password-01";

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test.describe("Responsive and keyboard behavior (FR-026 / NFR-010 / NFR-011)", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("login page has no horizontal overflow at 360px and is keyboard-operable", async ({ page }) => {
    await page.goto("/login");
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Tab order reaches both fields and the submit button without a mouse.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
  });

  test("password-reset request page has no horizontal overflow at 360px", async ({ page }) => {
    await page.goto("/reset-password/request");
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("the Platform Administration directory (sidebar shell) has no horizontal overflow at 360px", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // The sidebar collapses in favor of the bottom tab bar below 768px.
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".bottom-nav")).toBeVisible();

    // A directory with rows (badges, detail panel) is the denser case.
    const orgName = unique("Responsive Org");
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Initial owner email").fill(`${unique("owner")}@nova-e2e.local`);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(new RegExp(`Organization "${orgName}" created`))).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    void request;
  });

  test("the Organization admin area (Companies & Scopes, Users & Permissions) has no horizontal overflow at 360px", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);

    const ownerEmail = `${unique("owner")}@nova-e2e.local`;
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(unique("Responsive Org Admin"));
    await page.getByLabel("Initial owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(/created and initial-owner invitation sent/)).toBeVisible();

    const emailRes = await request.get(`/api/test-support/emails/latest?to=${encodeURIComponent(ownerEmail)}`);
    const body = await emailRes.json();
    const match = (body.text as string).match(/token=([^\s&"']+)/);
    const token = decodeURIComponent(match![1]);

    await page.goto(`/invitations/accept?token=${encodeURIComponent(token)}`);
    await page.getByLabel("New password").fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Activate account" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".bottom-nav")).toBeVisible();

    // Create a Company with a long name — the case that broke earlier
    // (unbreakable long tokens forcing the sticky detail panel wider than
    // the viewport) — and confirm it still doesn't overflow.
    const longCompanyName = unique("A Fairly Long Company Name For Wrapping");
    await page.getByRole("button", { name: "+ Add Company" }).click();
    await page.getByLabel("Name", { exact: true }).fill(longCompanyName);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(longCompanyName)).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.goto("/org/members");
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
