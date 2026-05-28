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

export async function generateWithLightcurveModel(modelName: string, prompt: string) {
  if (hasVertexAI()) {
    const vertex = new VertexAI({ project: vertexProject(), location: vertexLocation() });
    const model = vertex.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = extractVertexText(result);
    if (text) return text;
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key') {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  }

  return null;
}
