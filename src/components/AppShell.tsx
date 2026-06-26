'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (authPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-white">
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      
      {/* Main Content Area with clean premium padding */}
      <main className="md:pl-[220px]">
        <div className="w-full px-4 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
