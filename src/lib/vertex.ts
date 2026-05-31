import { VertexAI } from '@google-cloud/vertexai';
import { GoogleGenerativeAI } from '@google/generative-ai';

function vertexProject() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
}

function vertexLocation() {
  return process.env.VERTEX_AI_LOCATION || process.env.GCP_REGION || 'us-central1';
}

function extractVertexText(result: any) {
  const parts = result?.response?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part: any) => part.text ?? '').join('').trim();
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
