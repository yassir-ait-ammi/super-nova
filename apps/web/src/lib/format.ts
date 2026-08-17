// The API returns status/profile as upper-snake enum values (e.g. "ACTIVE",
// "ADMINISTRATOR"). The UX reference pack renders these as Title Case
// ("Active", "Administrateur"), never as raw enum text — this normalizes to
// that convention for display only; the enum value itself is unchanged.
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
