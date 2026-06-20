import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    integrations: [{
      id: 'pipecat-sdk',
      name: 'Lightcurve Pipecat SDK',
      mode: 'outbound-runtime',
      telephony: false,
      configured: true,
    }],
    media: {
      transport: 'webrtc',
      stunConfigured: Boolean(process.env.LIGHTCURVE_STUN_URL),
      turnConfigured: Boolean(process.env.LIGHTCURVE_TURN_URL),
      telephony: false,
    },
  });
}
