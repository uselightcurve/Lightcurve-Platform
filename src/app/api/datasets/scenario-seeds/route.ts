import { NextResponse } from 'next/server';
import { normalizeDatasetRows, seedToScenario } from '@/lib/datasetScenarios';

export async function GET() {
  return NextResponse.json({
    seeds: normalizeDatasetRows({ provider: 'huggingface', dataset: 'demo-scenario-seeds' }),
    preview: true,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const seeds = normalizeDatasetRows(body);

  return NextResponse.json({
    seeds,
    scenarios: seeds.map(seedToScenario),
    preview: !body.rows?.length,
  });
}
