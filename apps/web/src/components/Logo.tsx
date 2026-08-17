export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="nova-logo-gradient" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39c6ff" />
          <stop offset="1" stopColor="#2f6bff" />
        </linearGradient>
      </defs>
      <path
        d="M20 2 L36 11 V29 L20 38 L4 29 V11 Z"
        stroke="url(#nova-logo-gradient)"
        strokeWidth="2.5"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M20 13 L28 17.5 V26.5 L20 31 L12 26.5 V17.5 Z"
        fill="url(#nova-logo-gradient)"
        opacity="0.9"
      />
    </svg>
  );
}
