import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { deriveCaseFromCapture } from '@/lib/humanDatasets';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await deriveCaseFromCapture({
      ownerUserId: account.userId,
      captureSessionId: id,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      language: typeof body.language === 'string' ? body.language : undefined,
      domain: typeof body.domain === 'string' ? body.domain : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Case could not be created.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
