export type LightcurveModelProvider = 'qwen' | 'kimi' | 'openai-compatible' | 'none';

export type LightcurveModelResult = {
  text: string | null;
  provider: LightcurveModelProvider;
  model: string;
  baseUrl?: string;
  location?: string;
  error?: string;
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function provider() {
  const configured = process.env.LIGHTCURVE_LLM_PROVIDER?.trim().toLowerCase();
  if (configured === 'qwen' || configured === 'self-hosted') return 'qwen' as const;
  if (configured === 'kimi' || configured === 'moonshot') return 'kimi' as const;
  if (configured === 'openai-compatible') return 'openai-compatible' as const;
  return 'qwen' as const;
}

function baseUrlForProvider(selected: Exclude<LightcurveModelProvider, 'none'>) {
  if (selected === 'qwen') return cleanBaseUrl(process.env.LIGHTCURVE_LLM_BASE_URL || 'http://qwen:8000');
  if (selected === 'kimi') return cleanBaseUrl(process.env.LIGHTCURVE_LLM_BASE_URL || 'https://api.moonshot.ai/v1');
  return cleanBaseUrl(process.env.LIGHTCURVE_LLM_BASE_URL || '');
}

function apiKeyForProvider(selected: Exclude<LightcurveModelProvider, 'none'>) {
  if (selected === 'qwen') return process.env.LIGHTCURVE_LLM_API_KEY?.trim();
  if (selected === 'kimi') return process.env.MOONSHOT_API_KEY?.trim() || process.env.LIGHTCURVE_LLM_API_KEY?.trim();
  return process.env.LIGHTCURVE_LLM_API_KEY?.trim();
}

function defaultModelFor(modelName: string | undefined, selected: Exclude<LightcurveModelProvider, 'none'>) {
  const requested = modelName?.trim();
  if (requested) return requested;
  if (selected === 'qwen') return process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'lightcurve-reasoner';
  if (selected === 'kimi') return process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'kimi-k2.6';
  return process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'lightcurve-reasoner';
}

function extractChatText(value: unknown) {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const choices = Array.isArray(body.choices) ? body.choices : [];
  for (const choice of choices) {
    const row = choice && typeof choice === 'object' ? choice as Record<string, unknown> : {};
    const message = row.message && typeof row.message === 'object' ? row.message as Record<string, unknown> : {};
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim();
    if (Array.isArray(message.content)) {
      const text = message.content.flatMap((part) => {
        const item = part && typeof part === 'object' ? part as Record<string, unknown> : {};
        if (typeof item.text === 'string') return [item.text];
        if (typeof item.content === 'string') return [item.content];
        return [];
      }).join('').trim();
      if (text) return text;
    }
    if (typeof row.text === 'string' && row.text.trim()) return row.text.trim();
  }
  return null;
}

export function stripModelJsonFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function describeLightcurveModel(result: Pick<LightcurveModelResult, 'provider' | 'model' | 'baseUrl' | 'location'>) {
  if (result.provider === 'none') return 'heuristic-fallback';
  return `${result.provider}:${result.model}`;
}

export async function generateWithLightcurveModelResult(
  modelName: string,
  prompt: string,
  options?: { system?: string; temperature?: number; responseFormat?: 'json_object'; maxTokens?: number; thinking?: boolean },
): Promise<LightcurveModelResult> {
  const selected = provider();
  const apiKey = apiKeyForProvider(selected);
  const baseUrl = baseUrlForProvider(selected);
  const model = defaultModelFor(modelName, selected);

  if (!baseUrl || (selected !== 'qwen' && (!apiKey || apiKey === 'dummy_key'))) {
    return { text: null, provider: 'none', model, error: `${selected} API credentials are not configured.` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LIGHTCURVE_LLM_TIMEOUT_MS || 90_000));
  try {
    const messages: ChatMessage[] = [
      ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
      { role: 'user', content: options?.thinking === false ? `${prompt}\n/no_think` : prompt },
    ];
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.2,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const raw = await response.text();
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    if (!response.ok) {
      const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
      const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {};
      throw new Error(typeof error.message === 'string' ? error.message : `LLM provider returned ${response.status}.`);
    }
    const text = extractChatText(parsed);
    return { text, provider: selected, model, baseUrl, error: text ? undefined : 'LLM provider returned no text.' };
  } catch (error) {
    return {
      text: null,
      provider: 'none',
      model,
      baseUrl,
      error: error instanceof Error ? error.message : 'LLM generation failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateWithLightcurveModel(modelName: string, prompt: string) {
  return (await generateWithLightcurveModelResult(modelName, prompt)).text;
}

export async function generateJsonWithLightcurveModel<T = Record<string, unknown>>(modelName: string, prompt: string) {
  const result = await generateWithLightcurveModelResult(modelName, prompt, { responseFormat: 'json_object' });
  if (!result.text) throw new Error(result.error || 'The model returned no JSON.');
  return { result, json: JSON.parse(stripModelJsonFence(result.text)) as T };
}

async function embeddingFromService(text: string) {
  const endpoint = process.env.EMBEDDING_SERVICE_URL?.replace(/\/$/, '');
  if (!endpoint) return null;
  const response = await fetch(`${endpoint}/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EMBEDDING_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.EMBEDDING_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify({ text, model: process.env.LIGHTCURVE_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2' }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Embedding service returned ${response.status}.`);
  return Array.isArray(body.embedding) ? body.embedding.map(Number).filter(Number.isFinite) : null;
}

function hashedEmbedding(text: string) {
  const vector = new Array(384).fill(0) as number[];
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % vector.length] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}

export async function generateTextEmbedding(text: string) {
  const embedding = await embeddingFromService(text);
  if (embedding?.length) return embedding;
  if (process.env.NODE_ENV === 'production') throw new Error('EMBEDDING_SERVICE_URL is required in production.');
  return hashedEmbedding(text);
}
