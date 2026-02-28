import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Watchmen — GCP IAM Explorer",
  description: "Query your GCP IAM permissions using natural language",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950">{children}</body>
    </html>
  );
}
