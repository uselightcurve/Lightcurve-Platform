import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAccount();
    await params;
    await req.json().catch(() => ({}));
    return NextResponse.json({
      error: 'Dataset contributions are disabled. Customer datasets, recordings, transcripts, and behavior graphs stay private to the owning account.',
    }, { status: 410 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Dataset contribution is unavailable.' }, { status: 500 });
  }
}
