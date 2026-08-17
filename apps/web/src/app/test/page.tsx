"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";
import {
  AlertCircleIcon,
  BuildingIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/icons";

// Static mock data reproducing the structure of
// assessment-docs/ux/style-reference/portfolio-desktop.png (dark shell,
// hierarchy, and visual direction only — the portfolio/KPI content itself
// is outside this assessment's functional scope, so nothing here is wired
// to the API). English labels per the UX pack's interpretation rules.

const ORG_NAME = "Horizon Group";
const PERIOD = "Q2 2026";
const CURRENT_USER = "Louis · Administrator";

const PRIORITY_OPERATION = {
  name: "Belvedere Residence",
  urgencyLabel: "Urgent",
  detail: "45 days overdue",
  action: "Request a status update from the vendor in charge",
};

type OperationStatus = "strain" | "attention" | "healthy";

const STATUS_LABEL: Record<OperationStatus, string> = {
  strain: "Under strain",
  attention: "Needs attention",
  healthy: "Healthy",
};

const STATUS_DOT_CLASS: Record<OperationStatus, string> = {
  strain: "status-dot-danger",
  attention: "status-dot-warning",
  healthy: "status-dot-success",
};

const COMPANIES = [
  {
    id: "horizon-promotion",
    name: "Horizon Promotion",
    operations: [
      { id: "belvedere", name: "Belvedere Residence", status: "strain" as OperationStatus },
      { id: "opal-gardens", name: "Opal Gardens", status: "attention" as OperationStatus },
    ],
  },
  {
    id: "capital-development",
    name: "Capital Development",
    operations: [{ id: "arts-wharf", name: "Arts Wharf", status: "healthy" as OperationStatus }],
  },
];

const TOTAL_OPERATIONS = COMPANIES.reduce((sum, c) => sum + c.operations.length, 0);

export default function StyleReferenceMockPage() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(COMPANIES.map((c) => [c.id, true]))
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={30} />
          <span className="sidebar-brand-name">NOVA</span>
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          <a href="#" className="sidebar-link" aria-current="page">
            <FolderIcon />
            Portfolio
          </a>
          <a href="#" className="sidebar-link">
            <SettingsIcon />
            Administration
          </a>
        </nav>
        <div className="sidebar-footer">
          <UserIcon size={14} />
          {CURRENT_USER}
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span className="context-chip">
              <BuildingIcon />
              {ORG_NAME}
            </span>
            <span className="context-chip">
              <CalendarIcon />
              {PERIOD}
            </span>
          </div>
          <span className="user-chip">
            <UserIcon size={16} />
            {CURRENT_USER}
          </span>
        </div>

        <main className="shell-content stack">
          <div>
            <p className="page-eyebrow">Overview</p>
            <h1 className="page-title">Portfolio</h1>
            <p className="page-subtitle">Your companies and real estate operations</p>
          </div>

          <div className="priority-banner" role="alert">
            <span className="priority-banner-icon">
              <AlertCircleIcon size={22} />
            </span>
            <p className="priority-banner-headline">1 operation under strain</p>
            <p className="priority-banner-detail">Belvedere Residence is today&apos;s top priority</p>
          </div>

          <section className="stack" style={{ gap: 10 }}>
            <h2 style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>To handle now</h2>
            <div className="feature-card">
              <span className="feature-card-icon">
                <BuildingIcon size={22} />
              </span>
              <div className="feature-card-body">
                <p className="feature-card-title">{PRIORITY_OPERATION.name}</p>
                <div className="feature-card-meta">
                  <span className="badge badge-danger">{PRIORITY_OPERATION.urgencyLabel}</span>
                  <span>{PRIORITY_OPERATION.detail}</span>
                </div>
              </div>
              <p className="feature-card-action">{PRIORITY_OPERATION.action}</p>
              <button>
                Open operation
                <ChevronRightIcon />
              </button>
            </div>
          </section>

          <section className="card stack">
            <div className="section-header">
              <h2>Your companies and operations</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="count-chip">
                  {COMPANIES.length} companies · {TOTAL_OPERATIONS} operations
                </span>
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <PlusIcon size={14} /> Add operation
                </button>
              </div>
            </div>

            <div className="stack" style={{ gap: 4 }}>
              {COMPANIES.map((company) => {
                const isExpanded = expanded[company.id] ?? false;
                return (
                  <div key={company.id}>
                    <div className="list-row" style={{ cursor: "default" }}>
                      <button
                        className="secondary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          fontWeight: 700,
                          fontSize: 15,
                        }}
                        aria-expanded={isExpanded}
                        onClick={() => setExpanded((e) => ({ ...e, [company.id]: !e[company.id] }))}
                      >
                        <BuildingIcon />
                        {company.name}
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="badge badge-neutral">
                          {company.operations.length} operation{company.operations.length === 1 ? "" : "s"}
                        </span>
                        <ChevronDownIcon />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="group-children">
                        {company.operations.map((op) => (
                          <div key={op.id} className="list-row">
                            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <BuildingIcon size={14} />
                              {op.name}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                              <span className="status-dot-label">
                                <span className={`status-dot ${STATUS_DOT_CLASS[op.status]}`} />
                                {STATUS_LABEL[op.status]}
                              </span>
                              <a href="#" className="link-row">
                                Open
                                <ChevronRightIcon />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
