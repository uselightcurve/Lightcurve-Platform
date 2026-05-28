import type { Metadata } from "next";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";

export const metadata: Metadata = {
  title: "Lightcurve Dashboard",
  description:
    "Run sandboxed phone-call tests for voice AI agents, score MOS and task quality, and gate releases before production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-screen bg-[#f3f4f6] text-slate-800" suppressHydrationWarning>
        <ClerkProvider>
          <Script id="strip-extension-hydration-attrs" strategy="beforeInteractive">
            {`document.querySelectorAll('[bis_skin_checked]').forEach(function (node) { node.removeAttribute('bis_skin_checked'); });`}
          </Script>
          <AnalyticsProvider>
            <AppShell>{children}</AppShell>
          </AnalyticsProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
