'use client';

import { SignOutButton } from '@clerk/nextjs';

export function ProfileSignOutButton() {
  return (
    <SignOutButton>
      <button className="btn-secondary min-h-9 px-3 py-1.5 text-sm">
        Sign out
      </button>
    </SignOutButton>
  );
}
