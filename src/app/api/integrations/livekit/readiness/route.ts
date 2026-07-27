import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { verifyLiveKitCredentials } from '@/lib/livekit';

const CUSTOMER_EMAIL = 'shivam@kolsetu.com';

async function health(name: string, url: string | undefined) {
  if (!url) throw new Error(`${name} URL is not configured.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/health`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`${name} returned ${response.status}.`);
    return 'ready';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${name} health check timed out while the service was waking up.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name: string, task: () => Promise<unknown>) {
  try {
    const detail = await task();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : 'Not ready.' };
  }
}

export async function GET() {
  try {
    const account = await requireAccount();
    if (account.email.trim().toLowerCase() !== CUSTOMER_EMAIL) {
      return NextResponse.json({ error: 'LiveKit readiness is only enabled for this customer account.' }, { status: 403 });
    }

    const checks = await Promise.all([
      check('livekit', async () => {
        return verifyLiveKitCredentials();
      }),
      check('speech', () => health('Speech', process.env.SPEECH_SERVICE_URL)),
      check('voice-clone', () => health('Voice clone', process.env.VOICE_CLONE_SERVICE_URL)),
      check('mos-scoring', () => health('MOS', process.env.MOS_SERVICE_URL)),
      check('conversation-eval', () => health('Evaluate', process.env.MODELORBIT_SERVICE_URL)),
      check('reasoning', async () => {
        if (!process.env.LIGHTCURVE_LLM_BASE_URL && process.env.LIGHTCURVE_LLM_PROVIDER !== 'none') {
          throw new Error('LIGHTCURVE_LLM_BASE_URL is not configured.');
        }
        return process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'lightcurve-reasoner';
      }),
      check('embedding', async () => {
        if (!process.env.EMBEDDING_SERVICE_URL) throw new Error('EMBEDDING_SERVICE_URL is not configured.');
        return process.env.LIGHTCURVE_EMBEDDING_MODEL || 'default embedding model';
      }),
    ]);

    return NextResponse.json({
      ok: checks.every((item) => item.ok),
      checkedAt: new Date().toISOString(),
      checks,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'LiveKit readiness could not be checked.' }, { status: 500 });
  }
}
