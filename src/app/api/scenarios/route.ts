import { NextResponse } from 'next/server';
import { db } from '@/db';
import { scenarios } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { DEMO_SCENARIOS } from '@/lib/demoData';

export async function GET() {
  try {
    let data = await db.select().from(scenarios).orderBy(desc(scenarios.createdAt));

    if (data.length === 0) {
      await db.insert(scenarios).values(DEMO_SCENARIOS).onConflictDoNothing();
      data = await db.select().from(scenarios).orderBy(desc(scenarios.createdAt));
    }

    return NextResponse.json({ scenarios: data.length ? data : DEMO_SCENARIOS });
  } catch (error) {
    console.error('Failed to load scenarios', error);
    return NextResponse.json({ scenarios: DEMO_SCENARIOS, preview: true });
  }
}
