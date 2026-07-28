import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { deletePrivateAudioObject, isPrivateAudioUri } from '@/lib/captureStorage';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [owned] = await db
      .select({ datasetCase: datasetCases, dataset: datasets })
      .from(datasetCases)
      .innerJoin(datasets, eq(datasetCases.datasetId, datasets.id))
      .where(and(eq(datasetCases.id, id), eq(datasets.ownerUserId, account.userId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });

    const provenance = owned.datasetCase.provenance as Record<string, unknown>;
    const audioUri = typeof provenance.audioUri === 'string' ? provenance.audioUri : '';
    if (provenance.source !== 'imported_audio' || !isPrivateAudioUri(audioUri)) {
      return NextResponse.json({ error: 'Only uploaded recordings can be deleted here.' }, { status: 400 });
    }

    await deletePrivateAudioObject(audioUri);
    await db.transaction(async (tx) => {
      await tx.delete(datasetCases).where(eq(datasetCases.id, id));
      await tx.update(datasets).set({
        currentVersion: owned.dataset.currentVersion + 1,
        updatedAt: new Date(),
      }).where(eq(datasets.id, owned.dataset.id));
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Recording deletion failed', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Recording could not be deleted.',
    }, { status: 500 });
  }
}
