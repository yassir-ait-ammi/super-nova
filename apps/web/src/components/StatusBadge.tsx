import { humanize } from "@/lib/format";
import { AlertTriangleIcon, BanIcon, CheckCircleIcon, ClockIcon, FlagIcon, MinusCircleIcon, UserIcon } from "./icons";

// Status → visual treatment, calibrated against the UX reference pack's
// Organization directory mockup (assessment-docs/ux/core/platform-organization-directory-reference.png):
// active states = green with white text; a temporary/urgent state (Suspended)
// is red — it needs attention now; a closed/terminal state (Disabled, Removed,
// Revoked) is neutral grey — it's already settled, not an open problem;
// Pilot/Demo commercial status is the cyan "info" treatment. Never color alone:
// every state also carries an icon and a text label.
const STATUS_CONFIG: Record<string, { className: string; icon: React.ReactNode }> = {
  ACTIVE: { className: "badge-active", icon: <CheckCircleIcon /> },
  PROVISIONING: { className: "badge-provisioning", icon: <ClockIcon /> },
  SUSPENDED: { className: "badge-danger", icon: <MinusCircleIcon /> },
  REMOVED: { className: "badge-neutral", icon: <BanIcon /> },
  DISABLED: { className: "badge-neutral", icon: <BanIcon /> },
  DEMO: { className: "badge-info", icon: <UserIcon size={14} /> },
  PILOT: { className: "badge-info", icon: <FlagIcon /> },
  PENDING: { className: "badge-provisioning", icon: <ClockIcon /> },
  EXPIRED: { className: "badge-danger", icon: <AlertTriangleIcon /> },
  REVOKED: { className: "badge-neutral", icon: <BanIcon /> },
  ACCEPTED: { className: "badge-active", icon: <CheckCircleIcon /> },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config = STATUS_CONFIG[status] ?? { className: "badge-neutral", icon: null };
  return (
    <span className={`badge ${config.className}`}>
      {config.icon && <span className="badge-icon">{config.icon}</span>}
      {label ?? humanize(status)}
    </span>
  );
}
