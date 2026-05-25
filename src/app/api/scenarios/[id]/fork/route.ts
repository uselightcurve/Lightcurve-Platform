import { NextResponse } from 'next/server';
import { db } from '@/db';
import { scenarios } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json(); // { name: '...', patch: [...] }
  
  const parentData = await db.select().from(scenarios).where(eq(scenarios.id, id));
  if (!parentData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parent = parentData[0];
  
  const newScenario = { ...parent };
  delete (newScenario as any).id;
  newScenario.parentId = id;
  newScenario.isPreset = false;
  newScenario.name = body.name || `${parent.name}_fork`;
  
  for (const p of body.patch || []) {
    if (p.path === '/language') newScenario.language = p.value;
    else if (p.path === '/persona/accent') (newScenario.persona as any).accent = p.value;
    else if (p.path === '/persona/name') (newScenario.persona as any).name = p.value;
    else if (p.path === '/persona/emotional_state') (newScenario.persona as any).emotional_state = p.value;
    else if (p.path === '/persona/goal') (newScenario.persona as any).goal = p.value;
  }
  
  const created = await db.insert(scenarios).values(newScenario as any).returning();
  return NextResponse.json({ scenario: created[0] });
}
