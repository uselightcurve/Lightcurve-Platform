import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { demoImportedCalls, type NormalizedCall } from '@/lib/integrations';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const call = (body.call as NormalizedCall | undefined) ?? demoImportedCalls[0];

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({
      recommendation: call.promptRecommendation,
      failureSummary: call.failureSummary,
      preview: true,
    });
  }

  const prompt = `
You are reviewing a failed voice AI production call.
Return concise JSON with "failureSummary" and "promptRecommendation".

Provider: ${call.provider}
Outcome: ${call.outcome}
MOS: ${call.mos}
Task completion: ${call.taskCompletion}
Transcript:
${call.transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}
`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Recommendation generation failed', error);
    return NextResponse.json({
      recommendation: call.promptRecommendation,
      failureSummary: call.failureSummary,
      preview: true,
    });
  }
}
