import { redirect } from 'next/navigation';

export default function LegacyApiKeysPage() {
  redirect('/settings/sdk');
}
