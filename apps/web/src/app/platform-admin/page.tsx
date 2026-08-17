"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  createOrganization,
  listOrganizations,
  OrganizationDirectoryItem,
} from "@/lib/api-client";
import { StatusBadge } from "@/components/StatusBadge";
import { BuildingIcon } from "@/components/icons";
import { OrganizationDetailPanel } from "./OrganizationDetailPanel";

export default function PlatformAdminPage() {
  const [items, setItems] = useState<OrganizationDirectoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh(searchValue?: string) {
    setLoading(true);
    setListError(null);
    try {
      const result = await listOrganizations({ search: searchValue });
      setItems(result.items);
      // Keep the current selection only if it's still in the (possibly
      // filtered) results; otherwise fall back to the first row so the
      // detail panel never silently shows a stale, out-of-view Organization.
      const stillPresent = result.items.some((i) => i.id === selectedId);
      if (!stillPresent) {
        setSelectedId(result.items.length > 0 ? result.items[0]!.id : null);
      }
    } catch {
      setListError("Could not load the Organization directory. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);
    setCreating(true);
    try {
      const created = await createOrganization(name, ownerEmail);
      setCreateSuccess(`Organization "${name}" created and initial-owner invitation sent to ${ownerEmail}.`);
      setName("");
      setOwnerEmail("");
      await refresh(search);
      setSelectedId(created.id);
    } catch (err) {
      setCreateError(
        err instanceof ApiError && err.code === "organization_name_taken"
          ? "An Organization with this name already exists."
          : "Could not create the Organization. Please check the details and try again."
      );
    } finally {
      setCreating(false);
    }
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Customer accounts</p>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">Create and supervise access without opening business data.</p>
        </div>
        <button className="lg" onClick={() => setShowCreateForm((v) => !v)} aria-expanded={showCreateForm}>
          + Create Organization
        </button>
      </div>

      {showCreateForm && (
        <section className="card stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>New Organization</h2>
          <form className="stack" onSubmit={onCreate} noValidate>
            <div className="field">
              <label htmlFor="org-name">Organization name</label>
              <input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="owner-email">Initial owner email</label>
              <input
                id="owner-email"
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </div>
            {createError && (
              <div className="alert alert-error" role="alert">
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="alert alert-success" role="status">
                {createSuccess}
              </div>
            )}
            <div>
              <button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create Organization & send invitation"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="split-view">
        <section className="card stack">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void refresh(search);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <label htmlFor="search" style={{ position: "absolute", left: -9999 }}>
              Search Organizations
            </label>
            <input
              id="search"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className="secondary">
              Search
            </button>
          </form>

          {listError && (
            <div className="alert alert-error" role="alert">
              {listError}
            </div>
          )}

          {loading ? (
            <p aria-live="polite" className="flex items-center justify-center">Loading…</p>
          ) : items.length === 0 ? (
            <p>No Organizations match this search.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col">Access</th>
                    <th scope="col">Commercial</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((org) => (
                    <tr
                      key={org.id}
                      onClick={() => setSelectedId(org.id)}
                      aria-selected={org.id === selectedId}
                      style={{
                        cursor: "pointer",
                        background: org.id === selectedId ? "var(--row-selected-bg)" : undefined,
                        boxShadow: org.id === selectedId ? "inset 0 0 0 1px var(--accent-hover)" : undefined,
                      }}
                    >
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 650, fontSize: 15 }}>
                          <span className="tile">
                            <BuildingIcon size={16} />
                          </span>
                          {org.name}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={org.accessStatus} />
                      </td>
                      <td>
                        <StatusBadge status={org.commercialStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>{items.length} organization(s)</p>
        </section>

        <div className="detail-panel">
          {selected ? (
            <OrganizationDetailPanel org={selected} onChange={() => refresh(search)} />
          ) : (
            <div className="card">
              <p style={{ color: "var(--text-muted)", margin: 0 }}>Select an Organization to see its details.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
