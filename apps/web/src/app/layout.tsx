import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Matches the UX reference pack's typeface exactly (ui/css/nova.css:
// "Plus Jakarta Sans", Inter, "SF Pro Display", system-ui, sans-serif).
// next/font self-hosts the font at build time — no runtime request to
// fonts.googleapis.com, so it works offline and isn't subject to a CSP.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NOVA",
  description: "NOVA platform administration and collaboration (assessment build)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
