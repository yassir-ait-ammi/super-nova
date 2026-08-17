"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  BusinessScope,
  checkBusinessScopeDuplicate,
  Company,
  createBusinessScope,
  createCompany,
  deactivateBusinessScope,
  deactivateCompany,
  listBusinessScopes,
  listCompanies,
} from "@/lib/api-client";
import { useOrg } from "@/lib/org-context";
import { humanize } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { BuildingIcon, ChevronDownIcon, FlagIcon, InfoIcon, UsersIcon } from "@/components/icons";

const SCOPE_TYPES = ["RESTAURANT", "PROPERTY_DEVELOPMENT", "CONSTRUCTION", "EVENT"] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

function WizardSteps({ step }: { step: 1 | 2 | 3 }) {
  const labels: Record<1 | 2 | 3, string> = { 1: "Attachment", 2: "Details", 3: "Review" };
  return (
    <div className="wizard-steps">
      {([1, 2, 3] as const).map((n, i) => (
        <div key={n} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : undefined }}>
          <div className="wizard-step" data-active={step === n} data-done={step > n}>
            <span className="wizard-step-number">{n}</span>
            {labels[n]}
          </div>
          {i < 2 && <div className="wizard-step-connector" />}
        </div>
      ))}
    </div>
  );
}

function CreateScopeWizard({
  organizationId,
  companyId,
  companyName,
  organizationName,
  onCreated,
  onCancel,
}: {
  organizationId: string;
  companyId: string;
  companyName: string;
  organizationName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [type, setType] = useState<ScopeType>("RESTAURANT");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [responsiblePerson, setResponsiblePerson] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function goToReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    try {
      const result = await checkBusinessScopeDuplicate(organizationId, { companyId, type, name });
      setDuplicate(result.duplicate);
      setStep(3);
    } catch {
      setError("Could not check for duplicates. Please retry.");
    } finally {
      setChecking(false);
    }
  }

  async function confirmCreate() {
    setSubmitting(true);
    setError(null);
    try {
      await createBusinessScope(organizationId, { companyId, type, name, location, responsiblePerson });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "business_scope_duplicate"
          ? "This Business Scope already exists."
          : "Could not create the Business Scope."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="crumbs">
        <button className="linkish" style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer" }} onClick={onCancel}>
          Companies &amp; Scopes
        </button>
        <span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}>
          <ChevronDownIcon size={12} />
        </span>
        <span className="here">Add a Business Scope</span>
      </p>
      <p className="page-eyebrow">New Business Scope</p>
      <h1 className="page-title" style={{ fontSize: 32 }}>
        Add a Business Scope
      </h1>
      <p className="page-subtitle">Attach the new operation to the right Company.</p>
      <WizardSteps step={step} />

      <div className="wizard-layout">
        <div className="card">
          {step === 1 && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setStep(2);
              }}
              noValidate
            >
              <div className="field">
                <label>
                  Company <span className="req" aria-hidden="true">*</span>
                </label>
                <input value={companyName} disabled />
              </div>
              <div className="field">
                <label htmlFor="scope-type">
                  Type <span className="req" aria-hidden="true">*</span>
                </label>
                <select id="scope-type" value={type} onChange={(e) => setType(e.target.value as ScopeType)}>
                  {SCOPE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit">Continue</button>
                <button type="button" className="secondary" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form className="stack" onSubmit={goToReview} noValidate>
              <div className="field">
                <label htmlFor="scope-name">
                  Name <span className="req" aria-hidden="true">*</span>
                </label>
                <input id="scope-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Parc Horizon Residence" />
              </div>
              <div className="field">
                <label htmlFor="scope-location">Location</label>
                <input id="scope-location" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="scope-responsible">Responsible person</label>
                <input id="scope-responsible" value={responsiblePerson} onChange={(e) => setResponsiblePerson(e.target.value)} />
              </div>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <p className="note" style={{ margin: "4px 0 0" }}>
                <InfoIcon size={16} />
                Financial and site-cadence data can be completed after creation.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" disabled={checking || !name.trim()}>
                  {checking ? "Checking…" : "Continue"}
                </button>
                <button type="button" className="secondary" onClick={() => setStep(1)}>
                  Back
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="stack">
              {duplicate && (
                <div className="alert alert-error" role="alert">
                  A Business Scope with this Company, type, and name already exists. Choose a different name or
                  type, or go back.
                </div>
              )}
              <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
                Review the details below, then confirm to create this Business Scope.
              </p>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmCreate} disabled={submitting || duplicate}>
                  {submitting ? "Creating…" : "Confirm and create"}
                </button>
                <button type="button" className="secondary" onClick={() => setStep(2)}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="card">
          <h3 style={{ fontSize: 18, fontWeight: 750, margin: "0 0 16px" }}>Summary</h3>
          <div className="summary-item">
            <BuildingIcon size={22} />
            <div>
              <span className="summary-item-label">Organization</span>
              {organizationName}
            </div>
          </div>
          <div className="summary-item">
            <BuildingIcon size={22} />
            <div>
              <span className="summary-item-label">Company</span>
              {companyName}
            </div>
          </div>
          <div className="summary-item">
            <FlagIcon size={22} />
            <div>
              <span className="summary-item-label">Type</span>
              {humanize(type)}
            </div>
          </div>
          {name && (
            <div className="summary-item">
              <UsersIcon size={22} />
              <div>
                <span className="summary-item-label">Name</span>
                {name}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="page-foot">
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

export default function CompaniesPage() {
  const org = useOrg();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scopesByCompany, setScopesByCompany] = useState<Record<string, BusinessScope[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [wizardCompanyId, setWizardCompanyId] = useState<string | null>(null);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const result = await listCompanies(org.organizationId);
      setCompanies(result.items);
    } catch {
      setError("Could not load Companies.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleExpand(companyId: string) {
    if (expanded === companyId) {
      setExpanded(null);
      return;
    }
    setExpanded(companyId);
    if (!scopesByCompany[companyId]) {
      const result = await listBusinessScopes(org.organizationId, { companyId });
      setScopesByCompany((prev) => ({ ...prev, [companyId]: result.items }));
    }
  }

  async function onCreateCompany(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createCompany(org.organizationId, newCompanyName);
      setNewCompanyName("");
      setShowCreateCompany(false);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "company_name_taken"
          ? "A Company with this name already exists."
          : "Could not create the Company."
      );
    }
  }

  async function onDeactivateCompany(companyId: string) {
    const reason = window.prompt("Reason for deactivating this Company:");
    if (!reason || reason.trim().length < 3) return;
    try {
      await deactivateCompany(org.organizationId, companyId, reason.trim());
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "company_has_active_business_scopes") {
        setError("This Company has active Business Scopes and cannot be deactivated until they are deactivated first.");
      } else {
        setError("Could not deactivate the Company.");
      }
    }
  }

  async function onDeactivateScope(companyId: string, scopeId: string) {
    const reason = window.prompt("Reason for deactivating this Business Scope:");
    if (!reason || reason.trim().length < 3) return;
    await deactivateBusinessScope(org.organizationId, scopeId, reason.trim());
    const result = await listBusinessScopes(org.organizationId, { companyId });
    setScopesByCompany((prev) => ({ ...prev, [companyId]: result.items }));
    await refresh();
  }

  const wizardCompany = companies.find((c) => c.id === wizardCompanyId);
  if (wizardCompany) {
    return (
      <CreateScopeWizard
        organizationId={org.organizationId}
        companyId={wizardCompany.id}
        companyName={wizardCompany.name}
        organizationName={org.organizationName}
        onCreated={async () => {
          const companyId = wizardCompany.id;
          setWizardCompanyId(null);
          const result = await listBusinessScopes(org.organizationId, { companyId });
          setScopesByCompany((prev) => ({ ...prev, [companyId]: result.items }));
          setExpanded(companyId);
          await refresh();
        }}
        onCancel={() => setWizardCompanyId(null)}
      />
    );
  }

  const selectedScope = selectedScopeId
    ? Object.values(scopesByCompany)
        .flat()
        .find((s) => s.id === selectedScopeId)
    : null;
  const selectedScopeCompany = selectedScope ? companies.find((c) => c.id === selectedScope.companyId) : null;

  return (
    <>
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1 className="page-title">Companies &amp; Scopes</h1>
          <p className="page-subtitle">Structure your Organization&apos;s Companies and Business Scopes.</p>
        </div>
        <button className="lg" onClick={() => setShowCreateCompany((v) => !v)} aria-expanded={showCreateCompany}>
          + Add Company
        </button>
      </div>

      {showCreateCompany && (
        <section className="card stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>New Company</h2>
          <form className="stack" onSubmit={onCreateCompany} noValidate>
            <div className="field">
              <label htmlFor="company-name">Name</label>
              <input id="company-name" required value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} />
            </div>
            <div>
              <button type="submit">Create</button>
            </div>
          </form>
        </section>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="split-view">
        <section className="card" style={{ padding: "8px 8px 4px" }}>
          {loading ? (
            <p className="flex items-center justify-center" aria-live="polite" style={{ padding: 16 }}>
              Loading…
            </p>
          ) : companies.length === 0 ? (
            <p style={{ padding: 16 }}>No authorized Companies yet.</p>
          ) : (
            companies.map((company) => (
              <div key={company.id} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "6px 10px" }}>
                  <button
                    className="secondary"
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flex: 1,
                      textAlign: "left",
                      minHeight: "unset",
                      boxShadow: "none",
                    }}
                    onClick={() => toggleExpand(company.id)}
                    aria-expanded={expanded === company.id}
                  >
                    <span style={{ color: "#7eb6ff" }}>
                      <BuildingIcon />
                    </span>
                    <strong style={{ fontSize: 16, fontWeight: 700 }}>{company.name}</strong>
                    {company.status !== "ACTIVE" && <StatusBadge status={company.status} />}
                    <span
                      style={{
                        transform: expanded === company.id ? "rotate(180deg)" : undefined,
                        color: "var(--text-muted)",
                        display: "inline-flex",
                      }}
                    >
                      <ChevronDownIcon />
                    </span>
                  </button>
                  {company.status === "ACTIVE" && expanded === company.id && (
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button className="ghost sm" onClick={() => setWizardCompanyId(company.id)}>
                        + Add scope
                      </button>
                      <button className="danger sm" onClick={() => onDeactivateCompany(company.id)}>
                        Deactivate
                      </button>
                    </div>
                  )}
                </div>

                {expanded === company.id && (
                  <div style={{ margin: "0 6px 8px" }}>
                    {(scopesByCompany[company.id] ?? []).length === 0 ? (
                      <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px" }}>No Business Scopes yet.</p>
                    ) : (
                      (scopesByCompany[company.id] ?? []).map((scope) => (
                        <div
                          key={scope.id}
                          className="list-row"
                          aria-selected={scope.id === selectedScopeId}
                          onClick={() => setSelectedScopeId(scope.id)}
                          style={{ minHeight: 58 }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
                            <span className="tile">
                              <BuildingIcon size={16} />
                            </span>
                            <span style={{ fontWeight: 650 }}>{scope.name}</span>
                            <span
                              style={{
                                color: "var(--text-muted)",
                                fontSize: "13.5px",
                                borderLeft: "1px solid var(--border-strong)",
                                paddingLeft: 14,
                              }}
                            >
                              {humanize(scope.type)}
                            </span>
                          </span>
                          <StatusBadge status={scope.status} />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        <div className="detail-panel">
          {selectedScope ? (
            <div className="card">
              <div className="hero-illu" aria-hidden="true">
                <BuildingIcon size={64} />
              </div>
              <h2 className="detail-title">{selectedScope.name}</h2>
              <div className="meta-list">
                <div className="meta-row">
                  <UsersIcon size={20} />
                  <div>
                    <div className="lab">Company</div>
                    <div className="val">{selectedScopeCompany?.name ?? "—"}</div>
                  </div>
                </div>
                <div className="meta-row">
                  <FlagIcon size={20} />
                  <div>
                    <div className="lab">Type</div>
                    <div className="val">{humanize(selectedScope.type)}</div>
                  </div>
                </div>
                <div className="meta-row">
                  <BuildingIcon size={20} />
                  <div>
                    <div className="lab">Status</div>
                    <div className="val">
                      <StatusBadge status={selectedScope.status} />
                    </div>
                  </div>
                </div>
              </div>
              {selectedScope.status === "ACTIVE" ? (
                <button
                  className="danger btn-wide"
                  style={{ width: "100%" }}
                  onClick={() => selectedScopeCompany && onDeactivateScope(selectedScopeCompany.id, selectedScope.id)}
                >
                  Deactivate
                </button>
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>This Business Scope is deactivated.</p>
              )}
            </div>
          ) : (
            <div className="card">
              <p style={{ color: "var(--text-muted)", margin: 0 }}>Select a Business Scope to see its details.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
