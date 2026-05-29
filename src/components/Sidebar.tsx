'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BillingUsageCard } from '@/components/BillingUsageCard';

const icons = {
  overview: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 11.4L12 4l8 7.4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6.2 10.7v8.6h4.1v-4.7h3.4v4.7h4.1v-8.6" />
    </svg>
  ),
  logs: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 12h3l1.8-5 4.1 11 2.2-6H20" />
    </svg>
  ),
  monitor: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 19V9.5m7 9.5V5m7 14v-6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 19h16" />
    </svg>
  ),
  scenarios: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 5.5h8a2 2 0 012 2v8.2a2 2 0 01-2 2H9.2L6 20v-3.2a2 2 0 01-1-1.7V7.5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8.5 10h7M8.5 13.5H13" />
    </svg>
  ),
  playground: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 7.2v9.6l7.2-4.8L9 7.2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
    </svg>
  ),
  experiments: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 4h8M9.2 4v6.4L6 18a1.5 1.5 0 001.4 2h9.2A1.5 1.5 0 0018 18l-3.2-7.6V4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 14h8" />
    </svg>
  ),
  settings: (
    <svg className="h-[17px] w-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 12.8a7.8 7.8 0 000-1.6l2-1.5-2-3.4-2.4 1a7.2 7.2 0 00-1.4-.8L14.8 4h-5.6l-.4 2.5a7.2 7.2 0 00-1.4.8l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 000 1.6l-2 1.5 2 3.4 2.4-1a7.2 7.2 0 001.4.8l.4 2.5h5.6l.4-2.5a7.2 7.2 0 001.4-.8l2.4 1 2-3.4-2-1.5z" />
    </svg>
  ),
};

const navItems = [
  { label: 'Overview', href: '/', icon: icons.overview, active: (path: string) => path === '/' },
  { label: 'Logs', href: '/logs', icon: icons.logs, active: (path: string) => path.startsWith('/logs') || path.includes('/runs/') },
  { label: 'Monitor', href: '/monitor', icon: icons.monitor, active: (path: string) => path.startsWith('/monitor') },
  { label: 'Scenarios', href: '/scenarios', icon: icons.scenarios, active: (path: string) => path.startsWith('/scenarios') },
  { label: 'Playground', href: '/playground', icon: icons.playground, active: (path: string) => path.startsWith('/playground') },
  { label: 'Experiments', href: '/experiments', icon: icons.experiments, active: (path: string) => path.startsWith('/experiments') },
  { label: 'Settings', href: '/settings/profile', icon: icons.settings, active: (path: string) => path.startsWith('/settings') },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-10 flex w-56 flex-col bg-white">
      <div className="px-3 py-3">
        <Link href="/" className="flex h-9 items-center rounded-md px-3.5 text-slate-900">
          <span className="text-[15px] font-bold">Lightcurve</span>
        </Link>
      </div>
      <nav className="flex-1 px-2 py-3">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const active = item.active(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex h-10 items-center gap-3 rounded-md px-3.5 text-[15px] transition-colors ${
                  active
                    ? 'bg-[#eef2ff] text-[#2448bb]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className={active ? 'text-[#2f5ae0]' : 'text-slate-500'}>{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="p-2">
        <BillingUsageCard />
      </div>
    </aside>
  );
}
