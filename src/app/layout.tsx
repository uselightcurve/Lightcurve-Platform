import type { Metadata } from "next";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Lightcurve Dashboard",
  description:
    "Run simulated phone-call sandboxes for voice AI agents, score MOS and task quality, and gate releases before production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-screen bg-[#f3f4f6] text-slate-800" suppressHydrationWarning>
        <ClerkProvider proxyUrl={process.env.NEXT_PUBLIC_CLERK_PROXY_URL}>
          <Script id="strip-extension-hydration-attrs" strategy="beforeInteractive">
            {`document.querySelectorAll('[bis_skin_checked]').forEach(function (node) { node.removeAttribute('bis_skin_checked'); });`}
          </Script>
          <AppShell>{children}</AppShell>
        </ClerkProvider>
      </body>
    </html>
  );
}
