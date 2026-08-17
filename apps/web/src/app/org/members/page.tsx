"use client";

import { FormEvent, useEffect, useState } from "react";
import { CAPABILITIES, Capability, PERMISSION_PRESETS, presetCapabilities } from "@nova/shared";
import {
  acceptOwnershipTransfer,
  ApiError,
  BusinessScope,
  cancelOwnershipTransfer,
  CollaboratorInvitation,
  Company,
  getPendingOwnershipTransfer,
  inviteCollaborator,
  listBusinessScopes,
  listCompanies,
  listInvitations,
  listMembers,
  Member,
  PendingOwnershipTransfer,
  promoteMember,
  proposeOwnershipTransfer,
  reactivateMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  suspendMember,
  updateMemberPermissions,
} from "@/lib/api-client";
import { useOrg } from "@/lib/org-context";
import { humanize } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { CheckCircleIcon, EditIcon, EyeIcon, ShieldCheckIcon, UsersIcon } from "@/components/icons";

type ScopeGrant = { companyId?: string; businessScopeId?: string };

const CAPABILITY_ICON: Record<Capability, React.ReactNode> = {
  VIEW_COMPANIES: <EyeIcon size={18} />,
  VIEW_BUSINESS_SCOPES: <EyeIcon size={18} />,
  MANAGE_COMPANIES: <EditIcon size={18} />,
  MANAGE_BUSINESS_SCOPES: <EditIcon size={18} />,
  MANAGE_COLLABORATORS: <ShieldCheckIcon size={18} />,
};

function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]/).filter(Boolean);
  const chars = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : local.slice(0, 2);
  return chars.toUpperCase();
}

/** Rights editor: explicit capabilities + which Companies/Business Scopes
 * they apply to. The scope picker is real, not decorative — `scopeGrants`
 * is a genuine field the API already accepts (PATCH .../permissions) that
 * the UI never previously exposed. */
function RightsEditor({
  capabilities,
  onCapabilitiesChange,
  grants,
  onGrantsChange,
  companies,
  scopesByCompany,
}: {
  capabilities: Capability[];
  onCapabilitiesChange: (next: Capability[]) => void;
  grants: ScopeGrant[];
  onGrantsChange: (next: ScopeGrant[]) => void;
  companies: Company[];
  scopesByCompany: Record<string, BusinessScope[]>;
}) {
  const [expandedCompanyIds, setExpandedCompanyIds] = useState<Set<string>>(new Set());

  function toggleCompanyExpand(companyId: string) {
    setExpandedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function hasCompanyGrant(companyId: string) {
    return grants.some((g) => g.companyId === companyId);
  }

  function hasScopeGrant(scopeId: string) {
    return grants.some((g) => g.businessScopeId === scopeId);
  }

  function toggleCompanyGrant(companyId: string) {
    onGrantsChange(
      hasCompanyGrant(companyId) ? grants.filter((g) => g.companyId !== companyId) : [...grants, { companyId }]
    );
  }

  function toggleScopeGrant(scopeId: string) {
    onGrantsChange(
      hasScopeGrant(scopeId) ? grants.filter((g) => g.businessScopeId !== scopeId) : [...grants, { businessScopeId: scopeId }]
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grant-group">
        <div className="grant-group-header" style={{ cursor: "default" }}>
          Explicit capabilities
        </div>
        {CAPABILITIES.map((cap) => (
          <div key={cap} className="permission-row">
            <span className="ico">{CAPABILITY_ICON[cap]}</span>
            <span className="lbl">{humanize(cap)}</span>
            <button
              type="button"
              className={`capability-check ${capabilities.includes(cap) ? "on" : ""}`}
              aria-pressed={capabilities.includes(cap)}
              aria-label={cap.replace(/_/g, " ")}
              onClick={() =>
                onCapabilitiesChange(
                  capabilities.includes(cap) ? capabilities.filter((c) => c !== cap) : [...capabilities, cap]
                )
              }
            >
              {capabilities.includes(cap) ? "✓" : ""}
            </button>
          </div>
        ))}
      </div>

      {companies.map((company) => {
        const scopes = scopesByCompany[company.id] ?? [];
        const isExpanded = expandedCompanyIds.has(company.id);
        return (
          <div key={company.id} className="grant-group">
            <button type="button" className="grant-group-header" onClick={() => toggleCompanyExpand(company.id)} aria-expanded={isExpanded}>
              <span className="path">{company.name}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  role="checkbox"
                  aria-checked={hasCompanyGrant(company.id)}
                  aria-label={`Grant the entire ${company.name} Company`}
                  className={`capability-check ${hasCompanyGrant(company.id) ? "on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCompanyGrant(company.id);
                  }}
                >
                  {hasCompanyGrant(company.id) ? "✓" : ""}
                </span>
              </span>
            </button>
            {isExpanded &&
              scopes.map((scope) => (
                <label key={scope.id} className="scope-check">
                  <input
                    type="checkbox"
                    checked={hasScopeGrant(scope.id)}
                    onChange={() => toggleScopeGrant(scope.id)}
                    style={{ width: 16, height: 16 }}
                  />
                  {scope.name}
                  <em style={{ fontStyle: "normal", color: "var(--text-muted)", fontSize: 13 }}>{humanize(scope.type)}</em>
                </label>
              ))}
          </div>
        );
      })}
      <p className="note" style={{ margin: 0 }}>
        Rights are effective only on the Companies and Business Scopes granted above; an ungranted collaborator sees
        nothing even with capabilities checked.
      </p>
    </div>
  );
}

function InviteForm({
  organizationId,
  companies,
  scopesByCompany,
  onInvited,
}: {
  organizationId: string;
  companies: Company[];
  scopesByCompany: Record<string, BusinessScope[]>;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [presetKey, setPresetKey] = useState("READ_ONLY");
  const [capabilities, setCapabilities] = useState<Capability[]>(presetCapabilities("READ_ONLY"));
  const [grants, setGrants] = useState<ScopeGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onPresetChange(next: string) {
    setPresetKey(next);
    setCapabilities(presetCapabilities(next));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await inviteCollaborator(organizationId, { email, presetKey, capabilities, scopeGrants: grants });
      setSuccess(`Invitation sent to ${email}.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? "Could not send the invitation." : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="preset">Permission preset (editable starting point)</label>
        <select id="preset" value={presetKey} onChange={(e) => onPresetChange(e.target.value)}>
          {PERMISSION_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {PERMISSION_PRESETS.find((p) => p.key === presetKey)?.description}
        </span>
      </div>
      <RightsEditor
        capabilities={capabilities}
        onCapabilitiesChange={setCapabilities}
        grants={grants}
        onGrantsChange={setGrants}
        companies={companies}
        scopesByCompany={scopesByCompany}
      />
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success" role="status">
          {success}
        </div>
      )}
      <div>
        <button type="submit" className="lg" disabled={submitting || !email}>
          {submitting ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </form>
  );
}

export default function MembersPage() {
  const org = useOrg();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<CollaboratorInvitation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scopesByCompany, setScopesByCompany] = useState<Record<string, BusinessScope[]>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCapabilities, setEditCapabilities] = useState<Capability[]>([]);
  const [editGrants, setEditGrants] = useState<ScopeGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transferSuccessor, setTransferSuccessor] = useState("");
  const [pendingTransfer, setPendingTransfer] = useState<PendingOwnershipTransfer | null>(null);

  async function refresh() {
    try {
      const [m, i, pt, companiesResult] = await Promise.all([
        listMembers(org.organizationId),
        listInvitations(org.organizationId),
        getPendingOwnershipTransfer(org.organizationId),
        listCompanies(org.organizationId),
      ]);
      setMembers(m);
      setInvitations(i);
      setPendingTransfer(pt);
      setCompanies(companiesResult.items);
      const scopesLists = await Promise.all(companiesResult.items.map((c) => listBusinessScopes(org.organizationId, { companyId: c.id })));
      const nextScopes: Record<string, BusinessScope[]> = {};
      companiesResult.items.forEach((c, idx) => {
        nextScopes[c.id] = scopesLists[idx]!.items;
      });
      setScopesByCompany(nextScopes);
    } catch {
      setError("Could not load members.");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(fn: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMessage);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? `Action failed: ${err.code.replace(/_/g, " ")}` : "Action failed.");
    }
  }

  function reasonPrompt(label: string): string | null {
    const reason = window.prompt(label);
    if (!reason || reason.trim().length < 3) return null;
    return reason.trim();
  }

  const activeAdministrators = members.filter((m) => m.profile === "ADMINISTRATOR" && m.state === "ACTIVE" && !m.isOwner);
  const editingMember = members.find((m) => m.id === editingId) ?? null;

  const grantedScopeNames = editGrants
    .map((g) => {
      if (g.companyId) return `${companies.find((c) => c.id === g.companyId)?.name ?? "Company"} (entire Company)`;
      if (g.businessScopeId) {
        for (const scopes of Object.values(scopesByCompany)) {
          const found = scopes.find((s) => s.id === g.businessScopeId);
          if (found) return found.name;
        }
      }
      return null;
    })
    .filter((n): n is string => Boolean(n));

  return (
    <>
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1 className="page-title">Users &amp; Permissions</h1>
          <p className="page-subtitle">Assign access by preset, explicit capability, and scope.</p>
        </div>
        <button className="lg" onClick={() => setShowInvite((v) => !v)} aria-expanded={showInvite}>
          Invite a user
        </button>
      </div>

      {showInvite && (
        <section className="card stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>Invite a collaborator</h2>
          <InviteForm organizationId={org.organizationId} companies={companies} scopesByCompany={scopesByCompany} onInvited={refresh} />
        </section>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="split-view-3">
        <section className="card col-card">
          <h2>Collaborators</h2>
          <div className="stack" style={{ gap: 4 }}>
            {members.map((m) => (
              <div key={m.id} data-testid="member-row">
                <button
                  className={`user-row ${m.profile === "USER" ? "" : ""}`}
                  aria-selected={m.id === editingId}
                  onClick={() => {
                    if (m.profile !== "USER") return;
                    setEditingId(editingId === m.id ? null : m.id);
                    setEditCapabilities(m.capabilities.map((c) => c.capability) as Capability[]);
                    setEditGrants(m.scopeGrants.map((g) => ({ companyId: g.companyId ?? undefined, businessScopeId: g.businessScopeId ?? undefined })));
                  }}
                  disabled={m.profile !== "USER"}
                  style={{ cursor: m.profile === "USER" ? "pointer" : "default" }}
                >
                  <span className={`avatar-circle ${m.profile === "ADMINISTRATOR" ? "role-administrator" : "role-user"}`}>
                    {initialsOf(m.identity.displayEmail)}
                  </span>
                  <span className="who">
                    <span className="name">{m.identity.displayEmail}</span>
                    <span className="role">{humanize(m.profile)}</span>
                  </span>
                  <StatusBadge status={m.state} />
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 8px 62px" }}>
                  {m.isOwner && <span className="badge badge-active">Owner</span>}
                  {m.profile === "USER" && m.state === "ACTIVE" && org.isOwner && (
                    <button
                      className="secondary sm"
                      onClick={() => {
                        const reason = reasonPrompt("Reason for promoting to Administrator:");
                        if (reason) void runAction(() => promoteMember(org.organizationId, m.id, reason), "Member promoted.");
                      }}
                    >
                      Promote
                    </button>
                  )}
                  {!m.isOwner && m.state === "ACTIVE" && (
                    <button
                      className="secondary sm"
                      onClick={() => {
                        const reason = reasonPrompt("Reason for suspending this collaborator:");
                        if (reason) void runAction(() => suspendMember(org.organizationId, m.id, reason), "Member suspended.");
                      }}
                    >
                      Suspend
                    </button>
                  )}
                  {!m.isOwner && m.state === "SUSPENDED" && (
                    <button
                      className="secondary sm"
                      onClick={() => {
                        const reason = reasonPrompt("Reason for reactivating this collaborator:");
                        if (reason) void runAction(() => reactivateMember(org.organizationId, m.id, reason), "Member reactivated.");
                      }}
                    >
                      Reactivate
                    </button>
                  )}
                  {!m.isOwner && m.state !== "REMOVED" && (
                    <button
                      className="danger sm"
                      onClick={() => {
                        const reason = reasonPrompt("Reason for removing this collaborator's access:");
                        if (reason) void runAction(() => removeMember(org.organizationId, m.id, reason), "Member removed.");
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card col-card">
          {editingMember ? (
            <>
              <h2>Rights of {editingMember.identity.displayEmail}</h2>
              <RightsEditor
                capabilities={editCapabilities}
                onCapabilitiesChange={setEditCapabilities}
                grants={editGrants}
                onGrantsChange={setEditGrants}
                companies={companies}
                scopesByCompany={scopesByCompany}
              />
              <div className="page-foot">
                <button className="secondary" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
                <button
                  className="lg"
                  onClick={() =>
                    runAction(
                      () => updateMemberPermissions(org.organizationId, editingMember.id, { capabilities: editCapabilities, scopeGrants: editGrants }),
                      "Permissions updated."
                    )
                  }
                >
                  Save rights
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Select a collaborator to view and edit their rights.</p>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: 20, fontWeight: 750, letterSpacing: "-0.02em", margin: "0 0 14px" }}>Effective rights</h2>
          {editingMember ? (
            <>
              <div className="avatar-circle lg">
                <UsersIcon size={22} />
              </div>
              <p className="effective-rights-summary">
                Access to <b>{grantedScopeNames.length}</b> scope{grantedScopeNames.length === 1 ? "" : "s"} ·{" "}
                {editCapabilities.length} active capabilit{editCapabilities.length === 1 ? "y" : "ies"}
              </p>
              <div className="effective-rights">
                <h3>Scopes</h3>
                {grantedScopeNames.length > 0 ? (
                  <ul>
                    {grantedScopeNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-faint)" }}>No Company or Business Scope granted yet.</p>
                )}
                <h3>Active capabilities</h3>
                <div className="effective-rights-list">
                  {editCapabilities.length > 0 ? (
                    editCapabilities.map((cap) => (
                      <span key={cap} className="effective-rights-item">
                        <CheckCircleIcon size={14} />
                        {humanize(cap)}
                      </span>
                    ))
                  ) : (
                    <p style={{ fontSize: 13, color: "var(--text-faint)", margin: 0 }}>No capabilities granted yet.</p>
                  )}
                </div>
              </div>
              <p className="note" style={{ margin: 0 }}>
                <UsersIcon size={16} />
                Rights are effective only on the Companies and Business Scopes this collaborator is granted.
              </p>
            </>
          ) : (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Select a collaborator to see their effective access.</p>
          )}
        </section>
      </div>

      <section className="card stack">
        <h2 style={{ fontSize: 16, margin: 0 }}>Pending invitations</h2>
        {invitations.filter((i) => i.status === "PENDING").length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No pending invitations.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {invitations
              .filter((i) => i.status === "PENDING")
              .map((inv) => (
                <li key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    {inv.normalizedEmail} — expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button className="secondary" onClick={() => runAction(() => resendInvitation(org.organizationId, inv.id), "Invitation resent.")}>
                      Resend
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        const reason = reasonPrompt("Reason for revoking this invitation:");
                        if (reason) void runAction(() => revokeInvitation(org.organizationId, inv.id, reason), "Invitation revoked.");
                      }}
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {(org.isOwner || pendingTransfer?.successor?.id === org.membershipId) && (
        <section className="card stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>Ownership transfer</h2>

          {pendingTransfer ? (
            <div className="stack">
              <div className="alert alert-success" role="status">
                Pending: {pendingTransfer.proposer?.identity.displayEmail} → {pendingTransfer.successor?.identity.displayEmail}{" "}
                (expires {new Date(pendingTransfer.expiresAt).toLocaleDateString()})
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {org.isOwner && (
                  <button
                    className="secondary"
                    onClick={() => {
                      const reason = reasonPrompt("Reason for cancelling this proposal:");
                      if (reason) {
                        void runAction(
                          () => cancelOwnershipTransfer(org.organizationId, pendingTransfer.id, reason),
                          "Ownership transfer cancelled."
                        );
                      }
                    }}
                  >
                    Cancel proposal
                  </button>
                )}
                {pendingTransfer.successor?.id === org.membershipId && (
                  <button onClick={() => runAction(() => acceptOwnershipTransfer(org.organizationId, pendingTransfer.id), "You are now the owner.")}>
                    Accept ownership
                  </button>
                )}
              </div>
            </div>
          ) : (
            org.isOwner && (
              <div className="stack">
                <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
                  Propose transfer to another active Administrator. Nothing changes until they accept. You remain an
                  Administrator afterwards.
                </p>
                <div className="field">
                  <label htmlFor="successor">Successor</label>
                  <select id="successor" value={transferSuccessor} onChange={(e) => setTransferSuccessor(e.target.value)}>
                    <option value="">Select an Administrator…</option>
                    {activeAdministrators.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.identity.displayEmail}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <button
                    disabled={!transferSuccessor}
                    onClick={() => {
                      const reason = reasonPrompt("Reason for proposing this ownership transfer:");
                      if (reason) {
                        void runAction(
                          () => proposeOwnershipTransfer(org.organizationId, transferSuccessor, reason),
                          "Ownership transfer proposed."
                        );
                      }
                    }}
                  >
                    Propose transfer
                  </button>
                </div>
              </div>
            )
          )}
        </section>
      )}
    </>
  );
}
