import { notFound } from 'next/navigation';
import { requireAdminAccount } from '@/lib/adminAccess';
import { CreditsAdminClient } from './CreditsAdminClient';

export default async function AdminCreditsPage() {
  try {
    await requireAdminAccount();
  } catch {
    notFound();
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Admin credits</h1>
        <p className="page-subtitle">Internal control for customer testing minutes and eval actions.</p>
      </div>
      <CreditsAdminClient />
    </div>
  );
}
