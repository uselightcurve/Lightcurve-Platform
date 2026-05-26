import { NextResponse } from 'next/server';
import { normalizeDatasetRows, seedToScenario, type DatasetScenarioSeed } from '@/lib/datasetScenarios';
import importedSeeds from '@/data/real-scenario-seeds.json';

export const dynamic = 'force-dynamic';

const realScenarioSeeds = (importedSeeds as DatasetScenarioSeed[]).filter((seed) => {
  return Boolean(seed.id && seed.source && seed.openingLine && seed.reviewStatus);
});

export async function GET() {
  if (realScenarioSeeds.length) {
    return NextResponse.json({
      seeds: realScenarioSeeds,
      preview: false,
      source: 'huggingface',
    });
  }

  return NextResponse.json({
    seeds: normalizeDatasetRows({ provider: 'huggingface', dataset: 'demo-scenario-seeds' }),
    preview: true,
    source: 'demo',
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
