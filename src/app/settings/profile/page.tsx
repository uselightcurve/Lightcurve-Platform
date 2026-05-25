import Link from 'next/link';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      <input className="input-field h-10" defaultValue={value} />
    </label>
  );
}

export default function ProfileSettingsPage() {
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

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">Profile details</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 p-5">
            <Field label="Name" value="Ayush Saxena" />
            <Field label="Email" value="ayush@example.com" />
            <Field label="Workspace" value="Default project" />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Role</span>
              <select className="select-field h-10" defaultValue="Owner">
                <option>Owner</option>
                <option>Developer</option>
                <option>Viewer</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end border-t border-slate-200 px-5 py-4">
            <button className="toolbar-button toolbar-button-primary">Save profile</button>
          </div>
        </section>
      </div>
    </div>
  );
}
