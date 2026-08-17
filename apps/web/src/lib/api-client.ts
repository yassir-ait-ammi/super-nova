"use client";

import { CSRF_HEADER_NAME } from "@nova/shared";

export class ApiError extends Error {
  code: string;
  correlationId: string;
  status: number;

  constructor(status: number, body: { code?: string; correlationId?: string }) {
    super(body.code ?? "request_failed");
    this.status = status;
    this.code = body.code ?? "request_failed";
    this.correlationId = body.correlationId ?? "unknown";
  }
}

let cachedCsrfToken: string | null = null;

function setCsrfToken(token: string | undefined) {
  if (token) cachedCsrfToken = token;
}

async function fetchCsrfToken(): Promise<string | null> {
  const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!res.ok) return null;
  const body = (await res.json()) as { csrfToken: string };
  cachedCsrfToken = body.csrfToken;
  return body.csrfToken;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

interface ApiFetchOptions {
  method?: string;
  body?: unknown;
}

/**
 * All calls go to same-origin `/api/*` (proxied to the API — see
 * next.config.js), so the __Host- session cookie is sent automatically by
 * the browser. Unsafe requests attach the CSRF header; on a 403
 * csrf_check_failed we transparently refetch the token once and retry, so a
 * stale in-memory token (e.g. after an unrelated session rotation) doesn't
 * surface as a user-facing error.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!SAFE_METHODS.has(method)) {
      if (!cachedCsrfToken) await fetchCsrfToken();
      if (cachedCsrfToken) headers[CSRF_HEADER_NAME] = cachedCsrfToken;
    }
    return fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  let res = await doFetch();
  if (res.status === 403 && !SAFE_METHODS.has(method)) {
    const refreshed = await fetchCsrfToken();
    if (refreshed) res = await doFetch();
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json() : {};

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export interface LoginResponse {
  csrfToken: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const result = await apiFetch<LoginResponse>("/auth/login", { method: "POST", body: { email, password } });
  setCsrfToken(result.csrfToken);
  return result;
}

export interface RegisterResponse {
  csrfToken: string;
  organizationId: string;
  organizationName: string;
}

export async function register(organizationName: string, email: string, password: string): Promise<RegisterResponse> {
  const result = await apiFetch<RegisterResponse>("/auth/register", {
    method: "POST",
    body: { organizationName, email, password },
  });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  cachedCsrfToken = null;
}

export interface MeResponse {
  identityId: string;
  email: string;
  isPlatformAdministrator: boolean;
}

export function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}

export function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return apiFetch("/auth/password-reset/request", { method: "POST", body: { email } });
}

export function completePasswordReset(token: string, password: string): Promise<{ ok: boolean }> {
  return apiFetch("/auth/password-reset/complete", { method: "POST", body: { token, password } });
}

export interface AcceptInvitationResponse {
  organizationId: string;
  organizationActivated: boolean;
  csrfToken: string;
}

export async function acceptInvitation(token: string, password: string): Promise<AcceptInvitationResponse> {
  const result = await apiFetch<AcceptInvitationResponse>("/invitations/accept", {
    method: "POST",
    body: { token, password },
  });
  setCsrfToken(result.csrfToken);
  return result;
}

export interface OrganizationDirectoryItem {
  id: string;
  name: string;
  accessStatus: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  commercialStatus: "DEMO" | "PILOT" | "ACTIVE";
  ownerContactEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDirectoryResponse {
  items: OrganizationDirectoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function listOrganizations(params: { search?: string; page?: number } = {}): Promise<OrganizationDirectoryResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.page) query.set("page", String(params.page));
  const qs = query.toString();
  return apiFetch<OrganizationDirectoryResponse>(`/platform-admin/organizations${qs ? `?${qs}` : ""}`);
}

export function createOrganization(name: string, ownerEmail: string): Promise<OrganizationDirectoryItem> {
  return apiFetch("/platform-admin/organizations", { method: "POST", body: { name, ownerEmail } });
}

export function getOrganization(id: string): Promise<OrganizationDirectoryItem> {
  return apiFetch(`/platform-admin/organizations/${id}`);
}

export function suspendOrganization(id: string, reason: string): Promise<OrganizationDirectoryItem> {
  return apiFetch(`/platform-admin/organizations/${id}/suspend`, { method: "POST", body: { reason } });
}

export function reactivateOrganization(id: string, reason: string): Promise<OrganizationDirectoryItem> {
  return apiFetch(`/platform-admin/organizations/${id}/reactivate`, { method: "POST", body: { reason } });
}

export function disableOrganization(id: string, reason: string): Promise<OrganizationDirectoryItem> {
  return apiFetch(`/platform-admin/organizations/${id}/disable`, { method: "POST", body: { reason } });
}

export function updateCommercialStatus(
  id: string,
  commercialStatus: "DEMO" | "PILOT" | "ACTIVE",
  reason: string
): Promise<OrganizationDirectoryItem> {
  return apiFetch(`/platform-admin/organizations/${id}/commercial-status`, {
    method: "PATCH",
    body: { commercialStatus, reason },
  });
}

// ---------------------------------------------------------------------------
// Organization administration: my org, Companies, Business Scopes, members
// ---------------------------------------------------------------------------

export interface MyOrganization {
  organizationId: string;
  organizationName: string;
  organizationAccessStatus: string;
  membershipId: string;
  profile: "ADMINISTRATOR" | "USER";
  isOwner: boolean;
}

export function getMyOrganization(): Promise<MyOrganization> {
  return apiFetch("/me/organization");
}

export function acceptExistingInvitation(token: string): Promise<{ organizationId: string; organizationActivated: boolean }> {
  return apiFetch("/invitations/accept-existing", { method: "POST", body: { token } });
}

export interface Company {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  _count?: { businessScopes: number };
}

export interface DirectoryResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function listCompanies(organizationId: string, params: { search?: string } = {}): Promise<DirectoryResponse<Company>> {
  const qs = params.search ? `?search=${encodeURIComponent(params.search)}` : "";
  return apiFetch(`/organizations/${organizationId}/companies${qs}`);
}

export function createCompany(organizationId: string, name: string): Promise<Company> {
  return apiFetch(`/organizations/${organizationId}/companies`, { method: "POST", body: { name } });
}

export function deactivateCompany(organizationId: string, companyId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/companies/${companyId}/deactivate`, {
    method: "POST",
    body: { reason },
  });
}

export interface BusinessScope {
  id: string;
  companyId: string;
  type: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  company?: { id: string; name: string };
}

export function listBusinessScopes(
  organizationId: string,
  params: { companyId?: string; search?: string } = {}
): Promise<DirectoryResponse<BusinessScope>> {
  const query = new URLSearchParams();
  if (params.companyId) query.set("companyId", params.companyId);
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return apiFetch(`/organizations/${organizationId}/business-scopes${qs ? `?${qs}` : ""}`);
}

export function checkBusinessScopeDuplicate(
  organizationId: string,
  input: { companyId: string; type: string; name: string }
): Promise<{ duplicate: boolean }> {
  return apiFetch(`/organizations/${organizationId}/business-scopes/check-duplicate`, { method: "POST", body: input });
}

export function createBusinessScope(
  organizationId: string,
  input: { companyId: string; type: string; name: string; externalId?: string; location?: string; responsiblePerson?: string }
): Promise<BusinessScope> {
  return apiFetch(`/organizations/${organizationId}/business-scopes`, { method: "POST", body: input });
}

export function deactivateBusinessScope(organizationId: string, businessScopeId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/business-scopes/${businessScopeId}/deactivate`, {
    method: "POST",
    body: { reason },
  });
}

export interface Member {
  id: string;
  profile: "ADMINISTRATOR" | "USER";
  isOwner: boolean;
  state: "ACTIVE" | "SUSPENDED" | "REMOVED";
  presetKey: string | null;
  identity: { displayEmail: string };
  capabilities: { capability: string }[];
  scopeGrants: { companyId: string | null; businessScopeId: string | null }[];
}

export function listMembers(organizationId: string): Promise<Member[]> {
  return apiFetch(`/organizations/${organizationId}/members`);
}

export function updateMemberPermissions(
  organizationId: string,
  membershipId: string,
  body: { presetKey?: string; capabilities: string[]; scopeGrants: { companyId?: string; businessScopeId?: string }[] }
) {
  return apiFetch(`/organizations/${organizationId}/members/${membershipId}/permissions`, { method: "PATCH", body });
}

export function suspendMember(organizationId: string, membershipId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/members/${membershipId}/suspend`, { method: "POST", body: { reason } });
}

export function reactivateMember(organizationId: string, membershipId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/members/${membershipId}/reactivate`, { method: "POST", body: { reason } });
}

export function removeMember(organizationId: string, membershipId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/members/${membershipId}/remove`, { method: "POST", body: { reason } });
}

export function promoteMember(organizationId: string, membershipId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/members/${membershipId}/promote`, { method: "POST", body: { reason } });
}

export interface CollaboratorInvitation {
  id: string;
  normalizedEmail: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
  presetKey: string | null;
}

export function listInvitations(organizationId: string): Promise<CollaboratorInvitation[]> {
  return apiFetch(`/organizations/${organizationId}/invitations`);
}

export function inviteCollaborator(
  organizationId: string,
  body: { email: string; presetKey?: string; capabilities: string[]; scopeGrants: { companyId?: string; businessScopeId?: string }[] }
) {
  return apiFetch(`/organizations/${organizationId}/invitations`, { method: "POST", body });
}

export function resendInvitation(organizationId: string, invitationId: string) {
  return apiFetch(`/organizations/${organizationId}/invitations/${invitationId}/resend`, { method: "POST", body: {} });
}

export function revokeInvitation(organizationId: string, invitationId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/invitations/${invitationId}/revoke`, { method: "POST", body: { reason } });
}

export interface PendingOwnershipTransfer {
  id: string;
  reason: string;
  expiresAt: string;
  proposer: { id: string; identity: { displayEmail: string } } | null;
  successor: { id: string; identity: { displayEmail: string } } | null;
}

export async function getPendingOwnershipTransfer(organizationId: string): Promise<PendingOwnershipTransfer | null> {
  const result = await apiFetch<{ proposal: PendingOwnershipTransfer | null }>(
    `/organizations/${organizationId}/ownership-transfer/pending`
  );
  return result.proposal;
}

export function proposeOwnershipTransfer(organizationId: string, successorMembershipId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/ownership-transfer/propose`, {
    method: "POST",
    body: { successorMembershipId, reason },
  });
}

export function cancelOwnershipTransfer(organizationId: string, proposalId: string, reason: string) {
  return apiFetch(`/organizations/${organizationId}/ownership-transfer/${proposalId}/cancel`, {
    method: "POST",
    body: { reason },
  });
}

export function acceptOwnershipTransfer(organizationId: string, proposalId: string) {
  return apiFetch(`/organizations/${organizationId}/ownership-transfer/${proposalId}/accept`, { method: "POST", body: {} });
}
