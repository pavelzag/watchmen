import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import CommandPalette from "@/components/CommandPalette";
import GlobalKeyNav from "@/components/GlobalKeyNav";

export const metadata: Metadata = {
  title: "WATCHMEN // CLOUD SECURITY EXPLORER",
  description: "Query your GCP and AWS cloud security using natural language",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ backgroundColor: "#090909" }}>
        {children}
        {/* Global command palette — available on every page via '/' key */}
        <CommandPalette />
        {/* Global Up/Down/Enter keyboard navigation */}
        <GlobalKeyNav />
        <Toaster
          toastOptions={{
            style: {
              background: "#0d0d0d",
              color: "#00ff41",
              border: "1px solid #005c16",
              borderRadius: "0",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "12px",
            },
          }}
          position="bottom-right"
        />
      </body>
    </html>
  );
}
