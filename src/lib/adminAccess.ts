import { currentUser } from '@clerk/nextjs/server';
import { requireAccount, type AccountContext } from '@/lib/account';

const DEFAULT_ADMIN_EMAILS = ['ayush@uselightcurve.com'];

export function adminEmails() {
  const configured = process.env.ADMIN_EMAILS
    ?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_ADMIN_EMAILS);
}

export function isAdminEmail(email: string) {
  return adminEmails().has(email.trim().toLowerCase());
}

export async function requireAdminAccount(): Promise<AccountContext> {
  const account = await requireAccount();
  if (!isAdminEmail(account.email)) {
    throw new Response('Not found', { status: 404 });
  }
  return account;
}

export async function requestAdminActor() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? '';
  return email && isAdminEmail(email) ? email.toLowerCase() : null;
}
