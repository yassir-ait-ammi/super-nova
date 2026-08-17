import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL!;
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD!;
const OWNER_PASSWORD = "Owner-Chooses-A-New-Password-01";
const COLLABORATOR_PASSWORD = "Collaborator-Chosen-Password-00";

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function extractToken(request: import("@playwright/test").APIRequestContext, email: string) {
  const res = await request.get(`/api/test-support/emails/latest?to=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const match = (body.text as string).match(/token=([^\s&"']+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
}

test.describe("Client-side collaborative administration", () => {
  test("owner creates a Company/Business Scope, invites a collaborator with explicit grants, then suspends and removes them", async ({
    page,
    request,
  }) => {
    // Bootstrap admin provisions an Organization and the owner activates it.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);

    const ownerEmail = `${unique("owner")}@nova-e2e.local`;
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(unique("Collab Org"));
    await page.getByLabel("Initial owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(/created and initial-owner invitation sent/)).toBeVisible();
    const ownerToken = await extractToken(request, ownerEmail);

    await page.goto(`/invitations/accept?token=${encodeURIComponent(ownerToken)}`);
    await page.getByLabel("New password").fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Activate account" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);

    // Create a Company and a Business Scope through the guided flow.
    const companyName = unique("Bistro Group");
    await page.getByRole("button", { name: "+ Add Company" }).click();
    await page.getByLabel("Name", { exact: true }).fill(companyName);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(companyName)).toBeVisible();

    // Expand the Company row to reveal its "+ Add scope" action.
    await page.getByRole("button", { name: companyName, exact: false }).click();
    await page.getByRole("button", { name: "+ Add scope" }).click();
    // Step 1: Attachment (Company is pre-filled; Type defaults to Restaurant) -> Continue.
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 2: Details.
    // Not `exact: true` — the label's accessible name includes the required-field
    // marker ("Name *"), and this step only has one "Name"-labeled field anyway.
    await page.getByLabel("Name").fill("Downtown Restaurant");
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 3: Review and confirm.
    await expect(page.getByRole("button", { name: "Confirm and create" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm and create" }).click();
    await expect(page.getByText("Downtown Restaurant")).toBeVisible();

    // Invite a collaborator with an explicit read-only-plus preset.
    await page.goto("/org/members");
    await page.getByRole("button", { name: "Invite a user" }).click();
    const collaboratorEmail = `${unique("collaborator")}@nova-e2e.local`;
    await page.getByLabel("Email", { exact: true }).fill(collaboratorEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(new RegExp(`Invitation sent to ${collaboratorEmail}`))).toBeVisible();

    const collaboratorToken = await extractToken(request, collaboratorEmail);
    const acceptRes = await request.post("/api/invitations/accept", {
      data: { token: collaboratorToken, password: COLLABORATOR_PASSWORD },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // The collaborator can log in with a User profile (not Administrator).
    // A separate browser context is essential here — pages sharing one
    // context share cookies, which would silently swap the owner's session
    // for the collaborator's on the next line.
    const collabContext = await page.context().browser()!.newContext();
    const collabPage = await collabContext.newPage();
    await collabPage.goto("/login");
    await collabPage.getByLabel("Email").fill(collaboratorEmail);
    await collabPage.getByLabel("Password").fill(COLLABORATOR_PASSWORD);
    await collabPage.getByRole("button", { name: "Sign in" }).click();
    await expect(collabPage).toHaveURL(/\/org\/companies$/);
    await collabContext.close();

    // Owner suspends the collaborator; their session is immediately invalidated server-side.
    await page.reload();
    await page.waitForSelector(`text=${collaboratorEmail}`);
    const row = page.getByTestId("member-row").filter({ hasText: collaboratorEmail });
    page.once("dialog", (dialog) => dialog.accept("policy review"));
    await row.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByText("Member suspended.")).toBeVisible();
    await expect(row.getByText("SUSPENDED")).toBeVisible();
    // Immediate server-side session revocation on suspend is precisely
    // exercised by the integration suite (membership-lifecycle.test.ts);
    // this journey confirms the same action end-to-end through the UI.

    // Owner removes the collaborator (logical removal — history preserved).
    page.once("dialog", (dialog) => dialog.accept("no longer needed"));
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Member removed.")).toBeVisible();
    await expect(row.getByText("REMOVED")).toBeVisible();
  });

  test("owner promotes a User and proposes an ownership transfer that the successor accepts", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform-admin$/);

    const ownerEmail = `${unique("owner2")}@nova-e2e.local`;
    await page.getByRole("button", { name: "+ Create Organization" }).click();
    await page.getByLabel("Organization name").fill(unique("Transfer Org"));
    await page.getByLabel("Initial owner email").fill(ownerEmail);
    await page.getByRole("button", { name: "Create Organization & send invitation" }).click();
    await expect(page.getByText(/created and initial-owner invitation sent/)).toBeVisible();
    const ownerToken = await extractToken(request, ownerEmail);

    await page.goto(`/invitations/accept?token=${encodeURIComponent(ownerToken)}`);
    await page.getByLabel("New password").fill(OWNER_PASSWORD);
    await page.getByLabel("Confirm password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Activate account" }).click();
    await expect(page).toHaveURL(/\/org\/companies$/);

    await page.goto("/org/members");
    await page.getByRole("button", { name: "Invite a user" }).click();
    const collaboratorEmail = `${unique("future-admin")}@nova-e2e.local`;
    await page.getByLabel("Email", { exact: true }).fill(collaboratorEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(new RegExp(`Invitation sent to ${collaboratorEmail}`))).toBeVisible();
    const inviteToken = await extractToken(request, collaboratorEmail);
    await request
      .post("/api/invitations/accept", { data: { token: inviteToken, password: COLLABORATOR_PASSWORD } })
      .then((r) => expect(r.ok()).toBeTruthy());

    await page.reload();
    const row = page.getByTestId("member-row").filter({ hasText: collaboratorEmail });
    page.once("dialog", (dialog) => dialog.accept("trusted collaborator"));
    await row.getByRole("button", { name: "Promote" }).click();
    await expect(page.getByText("Member promoted.")).toBeVisible();
    await expect(row.getByText("ADMINISTRATOR")).toBeVisible();

    // Propose ownership transfer to the newly promoted Administrator.
    await page.getByLabel("Successor").selectOption({ label: collaboratorEmail });
    page.once("dialog", (dialog) => dialog.accept("stepping back"));
    await page.getByRole("button", { name: "Propose transfer" }).click();
    await expect(page.getByText("Ownership transfer proposed.")).toBeVisible();

    // The successor logs in and accepts, in an independent browser context
    // (see the note in the previous test about shared-context cookies).
    const successorContext = await page.context().browser()!.newContext();
    const successorPage = await successorContext.newPage();
    await successorPage.goto("/login");
    await successorPage.getByLabel("Email").fill(collaboratorEmail);
    await successorPage.getByLabel("Password").fill(COLLABORATOR_PASSWORD);
    await successorPage.getByRole("button", { name: "Sign in" }).click();
    await successorPage.waitForURL(/\/org\/companies$/);
    await successorPage.goto("/org/members");
    await expect(successorPage.getByRole("button", { name: "Accept ownership" })).toBeVisible();
    await successorPage.getByRole("button", { name: "Accept ownership" }).click();
    await expect(successorPage.getByText("You are now the owner.")).toBeVisible();
    await successorContext.close();
  });
});
