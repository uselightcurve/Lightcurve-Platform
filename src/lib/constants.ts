export const VOICE_MAP: Record<string, string> = {
  'en-US': 'en-US-Neural2-F',
  'en-GB': 'en-GB-Neural2-A',
  'en-AU': 'en-AU-Neural2-A',
  'hi-IN': 'hi-IN-Neural2-A',
  'ta-IN': 'ta-IN-Standard-A',
  'fr-FR': 'fr-FR-Neural2-E',
  'de-DE': 'de-DE-Neural2-F',
  'es-ES': 'es-ES-Neural2-A',
  'pt-BR': 'pt-BR-Neural2-A',
  'it-IT': 'it-IT-Neural2-A',
};

export const STT_CONFIG = {
  model: 'chirp',
  encoding: 'WEBM_OPUS',
  sampleRateHertz: 48000,
  enableWordTimeOffsets: true,
  enableAutomaticPunctuation: true,
};
