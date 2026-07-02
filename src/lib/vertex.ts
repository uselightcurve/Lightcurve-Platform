import { VertexAI } from '@google-cloud/vertexai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';

function vertexProject() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
}

function vertexLocation() {
  return process.env.VERTEX_AI_LOCATION || process.env.GCP_REGION || 'us-central1';
}

function extractVertexText(result: unknown) {
  const response = result && typeof result === 'object' ? (result as { response?: unknown }).response : undefined;
  const candidates = response && typeof response === 'object' ? (response as { candidates?: unknown }).candidates : undefined;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const content = first && typeof first === 'object' ? (first as { content?: unknown }).content : undefined;
  const parts = content && typeof content === 'object' ? (content as { parts?: unknown }).parts : undefined;
  return (Array.isArray(parts) ? parts : []).map((part) => {
    return part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '';
  }).join('').trim();
}

export function hasVertexAI() {
  return Boolean(vertexProject());
}

export type LightcurveModelProvider = 'vertex-ai' | 'gemini-api' | 'none';

export type LightcurveModelResult = {
  text: string | null;
  provider: LightcurveModelProvider;
  model: string;
  project?: string;
  location?: string;
  error?: string;
};

export function describeLightcurveModel(result: Pick<LightcurveModelResult, 'provider' | 'model' | 'location'>) {
  if (result.provider === 'vertex-ai') {
    return `vertex-ai:${result.model}${result.location ? `:${result.location}` : ''}`;
  }
  if (result.provider === 'gemini-api') return `gemini-api:${result.model}`;
  return 'heuristic-fallback';
}

export async function generateWithLightcurveModelResult(modelName: string, prompt: string): Promise<LightcurveModelResult> {
  const project = vertexProject();
  const location = vertexLocation();

  if (hasVertexAI()) {
    try {
      const vertex = new VertexAI({ project, location });
      const model = vertex.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = extractVertexText(result);
      if (text) return { text, provider: 'vertex-ai', model: modelName, project, location };
    } catch (error) {
      console.warn('Vertex AI generation failed; attempting configured fallback.', error);
    }
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key') {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return { text: result.response.text().trim(), provider: 'gemini-api', model: modelName };
    } catch (error) {
      return {
        text: null,
        provider: 'none',
        model: modelName,
        error: error instanceof Error ? error.message : 'Gemini API generation failed.',
      };
    }
  }

  return { text: null, provider: 'none', model: modelName };
}

export async function generateWithLightcurveModel(modelName: string, prompt: string) {
  return (await generateWithLightcurveModelResult(modelName, prompt)).text;
}

export async function generateMultimodalWithLightcurveModelResult(
  modelName: string,
  prompt: string,
  files: Array<{ uri: string; mimeType: string }>,
): Promise<LightcurveModelResult> {
  const project = vertexProject();
  const location = vertexLocation();
  let vertexError: string | undefined;
  
  if (project) {
    try {
      const vertex = new VertexAI({ project, location });
      const model = vertex.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            ...files.filter((file) => file.uri.startsWith('gs://')).map((file) => ({ fileData: { fileUri: file.uri, mimeType: file.mimeType } })),
          ],
        }],
      });
      const text = extractVertexText(result);
      if (text) {
        return { text, provider: 'vertex-ai', model: modelName, project, location };
      } else {
        vertexError = `Vertex AI returned empty text. Raw result: ${JSON.stringify(result)}`;
      }
    } catch (error) {
      vertexError = error instanceof Error ? error.message : String(error);
      console.warn('Vertex AI multimodal generation failed; attempting configured fallback.', error);
    }
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key') {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const { downloadPrivateGcsObject } = await import('@/lib/captureStorage');

      const parts: any[] = [{ text: prompt }];
      for (const file of files) {
        if (file.uri.startsWith('gs://')) {
          const bytes = await downloadPrivateGcsObject(file.uri);
          parts.push({
            inlineData: {
              data: bytes.toString('base64'),
              mimeType: file.mimeType,
            }
          });
        }
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts }]
      });

      return { text: result.response.text().trim(), provider: 'gemini-api', model: modelName };
    } catch (error) {
      return {
        text: null,
        provider: 'none',
        model: modelName,
        error: error instanceof Error ? error.message : 'Gemini API multimodal generation failed.',
      };
    }
  }

  return { text: null, provider: 'none', model: modelName, error: vertexError ? `Vertex AI failed: ${vertexError}` : 'No multimodal AI provider is configured.' };
}

export async function generateTextEmbedding(text: string) {
  const project = vertexProject();
  const location = vertexLocation();
  const model = process.env.LIGHTCURVE_EMBEDDING_MODEL || 'text-embedding-005';
  if (project) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
    const response = await client.request<{ predictions?: Array<{ embeddings?: { values?: number[] }; values?: number[] }> }>({
      url,
      method: 'POST',
      data: { instances: [{ content: text, task_type: 'SEMANTIC_SIMILARITY' }] },
    });
    const prediction = response.data.predictions?.[0];
    const values = prediction?.embeddings?.values ?? prediction?.values;
    if (Array.isArray(values) && values.length) return values.map(Number);
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key') {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const result = await genAI.getGenerativeModel({ model }).embedContent(text);
    if (result.embedding.values.length) return result.embedding.values;
  }
  throw new Error('Vertex text embeddings are unavailable.');
}
