import Link from 'next/link';
import { UserProfile } from '@clerk/nextjs';
import { requireAccount } from '@/lib/account';

export default async function ProfileSettingsPage() {
  const account = await requireAccount();

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Your profile</h1>
        <p className="page-subtitle">Manage account details and workspace access.</p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-5">
        <aside className="card p-2">
          <Link href="/settings/profile" className="flex h-9 items-center rounded-md bg-slate-100 px-3 text-sm font-medium text-slate-900">
            Your profile
          </Link>
          <Link href="/settings/billing" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Billing
          </Link>
        </aside>

        <section className="space-y-4">
          <div className="card p-5">
            <p className="text-sm font-medium text-slate-900">{account.name || account.email}</p>
            <p className="mt-1 text-sm text-slate-500">{account.email}</p>
          </div>
          <div className="card overflow-hidden p-4">
            <UserProfile routing="hash" />
          </div>
        </section>
      </div>
    </div>
  );
}
