import { redirect } from 'next/navigation';

export default function LegacyScenarioForkPage() {
  redirect('/datasets');
}
