import { NextResponse } from 'next/server';
import { getProviderStatuses } from '@/lib/integrations';

export async function GET() {
  return NextResponse.json({ providers: getProviderStatuses() });
}
