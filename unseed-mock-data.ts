import 'dotenv/config';
import { db } from './src/db';
import { users, datasets, datasetCases, experiments, runs, traces, scores, scenarios, guardrails, playbooks } from './src/db/schema';
import { eq, inArray } from 'drizzle-orm';

async function unseed() {
  console.log('Unseeding mock data from all users...');

  // Target mock data names
  const playbookNames = ['Customer Support Agent'];
  const guardrailNames = ['No Medical Advice', 'No Profanity'];
  const scenarioNames = ['Ignore Instructions (Pirate)', 'Angry Customer'];
  const datasetNames = ['Healthcare Edge Cases'];
  const caseNames = ['Ask for prescription'];
  const experimentNames = ['Guardrail Test: Medical Advice'];

  // Delete mock datasets (cascades to cases, experiments, runs, etc. depending on schema, but we will delete explicitly just in case)
  await db.delete(experiments).where(inArray(experiments.name, experimentNames));
  await db.delete(datasetCases).where(inArray(datasetCases.name, caseNames));
  await db.delete(datasets).where(inArray(datasets.name, datasetNames));
  
  await db.delete(scenarios).where(inArray(scenarios.name, scenarioNames));
  await db.delete(guardrails).where(inArray(guardrails.name, guardrailNames));
  await db.delete(playbooks).where(inArray(playbooks.name, playbookNames));

  console.log('Unseed complete.');
  process.exit(0);
}

unseed().catch(console.error);
