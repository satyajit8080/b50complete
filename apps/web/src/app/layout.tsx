import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bull50 — India's AI-Powered Stock Market Platform",
  description:
    "Live NSE market data, AI-driven research, option chain analytics, and portfolio tools — all in one platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-white min-h-screen antialiased">{children}</body>
    </html>
  );
}
