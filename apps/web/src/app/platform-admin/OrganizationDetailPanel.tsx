"use client";

import { useState } from "react";
import {
  disableOrganization,
  OrganizationDirectoryItem,
  reactivateOrganization,
  suspendOrganization,
  updateCommercialStatus,
} from "@/lib/api-client";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertTriangleIcon, BuildingIcon, CheckCircleIcon, FlagIcon, InfoIcon, UsersIcon } from "@/components/icons";

type Action = "suspend" | "reactivate" | "disable" | null;

export function OrganizationDetailPanel({
  org,
  onChange,
}: {
  org: OrganizationDirectoryItem;
  onChange: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmAction() {
    if (!pendingAction || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const fn =
        pendingAction === "suspend" ? suspendOrganization : pendingAction === "reactivate" ? reactivateOrganization : disableOrganization;
      await fn(org.id, reason.trim());
      setPendingAction(null);
      setReason("");
      onChange();
    } catch {
      setError("This action could not be completed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function onCommercialChange(next: "DEMO" | "PILOT" | "ACTIVE") {
    if (next === org.commercialStatus) return;
    const changeReason = window.prompt("Reason for changing commercial status:");
    if (!changeReason || changeReason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await updateCommercialStatus(org.id, next, changeReason.trim());
      onChange();
    } catch {
      setError("Could not update commercial status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="tile">
          <BuildingIcon size={16} />
        </div>
        <h2 className="feature-card-title" style={{ margin: 0 }}>
          {org.name}
        </h2>
      </div>

      <dl className="kv-list">
        <div className="kv-row">
          <dt>
            <CheckCircleIcon size={16} /> Access state
          </dt>
          <dd>
            <StatusBadge status={org.accessStatus} />
          </dd>
        </div>
        <div className="kv-row">
          <dt>
            <FlagIcon size={16} /> Commercial status
          </dt>
          <dd>
            <StatusBadge status={org.commercialStatus} />
          </dd>
        </div>
        <div className="kv-row">
          <dt>
            <UsersIcon size={16} /> Owner contact
          </dt>
          <dd>{org.ownerContactEmail ?? "—"}</dd>
        </div>
      </dl>

      <p style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
        <InfoIcon size={16} />
        No business data is accessible from this view.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {org.accessStatus === "ACTIVE" && (
          <button className="secondary" disabled={busy} onClick={() => setPendingAction("suspend")}>
            Suspend access
          </button>
        )}
        {org.accessStatus === "SUSPENDED" && (
          <button className="secondary" disabled={busy} onClick={() => setPendingAction("reactivate")}>
            Reactivate
          </button>
        )}
        {(org.accessStatus === "ACTIVE" || org.accessStatus === "SUSPENDED") && (
          <button className="danger" disabled={busy} onClick={() => setPendingAction("disable")}>
            Disable permanently
          </button>
        )}
        {org.accessStatus === "DISABLED" && (
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: 13 }}>
            This Organization is terminally disabled and cannot be reactivated.
          </p>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
        <p className="summary-item-label" style={{ marginBottom: 8 }}>
          Commercial status
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["DEMO", "PILOT", "ACTIVE"] as const).map((status) => (
            <button
              key={status}
              className="secondary"
              disabled={busy || org.commercialStatus === status}
              onClick={() => onCommercialChange(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="alert" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning)" }}>
        <AlertTriangleIcon />
        Reauthentication and a reason are required for every sensitive action.
      </div>

      {pendingAction && (
        <div className="card stack" role="dialog" aria-modal="true" aria-label={`Confirm ${pendingAction}`}>
          <h3 style={{ fontSize: 15, margin: 0 }}>
            Confirm: {pendingAction} {org.name}
          </h3>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
            {pendingAction === "disable"
              ? "This permanently ends access for every member and cannot be reversed in this product."
              : pendingAction === "suspend"
                ? "Every current session for this Organization's members will be signed out immediately."
                : "Members regain access with only their currently valid grants."}
          </p>
          <div className="field">
            <label htmlFor="reason">Reason (required)</label>
            <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmAction} disabled={busy || reason.trim().length < 3}>
              Confirm {pendingAction}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setPendingAction(null);
                setReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
