'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

  if (authPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Sidebar />
      <main className="min-h-screen pl-56">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-4">{children}</div>
      </main>
    </>
  );
}
