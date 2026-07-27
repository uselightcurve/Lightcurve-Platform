import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    integrations: [{
      id: 'pipecat-sdk',
      name: 'Lightcurve Pipecat SDK',
      mode: 'outbound-runtime',
      sdkVersion: '0.5.0',
      graphSchema: 'lightcurve.human_behavior_graph.v2',
      telephony: false,
      configured: true,
    }],
    media: {
      transport: 'webrtc',
      stunConfigured: Boolean(process.env.LIGHTCURVE_STUN_URL),
      turnConfigured: Boolean(process.env.LIGHTCURVE_TURN_URL),
      telephony: false,
      hostedRunner: false,
    },
    evaluation: {
      included: true,
      externalKeyRequired: false,
      voiceMeasurementsConfigured: Boolean(process.env.MODELORBIT_SERVICE_URL),
      storedResults: true,
    },
  });
}
