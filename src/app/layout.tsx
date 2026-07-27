import type { Metadata } from "next";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { clerkPublishableKey } from "@/lib/clerkEnv";
import { isMockMode } from "@/lib/mockData";

export const metadata: Metadata = {
  title: "Lightcurve Dashboard",
  description:
    "Capture real human voice interactions, turn them into behavioral datasets, and replay them across voice-agent versions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const app = (
    <>
      <Script id="strip-extension-hydration-attrs" strategy="beforeInteractive">
        {`document.querySelectorAll('[bis_skin_checked]').forEach(function (node) { node.removeAttribute('bis_skin_checked'); });`}
      </Script>
      {isMockMode() ? (
        <AppShell>{children}</AppShell>
      ) : (
        <AnalyticsProvider>
          <AppShell>{children}</AppShell>
        </AnalyticsProvider>
      )}
    </>
  );

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-screen bg-[#f3f4f6] text-slate-800" suppressHydrationWarning>
        {isMockMode() ? app : <ClerkProvider publishableKey={clerkPublishableKey()}>{app}</ClerkProvider>}
      </body>
    </html>
  );
}
