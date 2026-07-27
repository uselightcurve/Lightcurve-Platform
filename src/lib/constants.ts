export const VOICE_MAP: Record<string, string> = {
  'en-US': 'en-US-Neural2-F',
  'en-IN': 'en-IN-Neural2-A',
  'en-GB': 'en-GB-Neural2-A',
  'en-AU': 'en-AU-Neural2-A',
  'hi-IN': 'hi-IN-Neural2-A',
  'ar-SA': 'ar-XA-Standard-A',
  'ta-IN': 'ta-IN-Standard-A',
  'fr-FR': 'fr-FR-Neural2-E',
  'de-DE': 'de-DE-Neural2-F',
  'es-ES': 'es-ES-Neural2-A',
  'pt-BR': 'pt-BR-Neural2-A',
  'it-IT': 'it-IT-Neural2-A',
  'pl-PL': 'pl-PL-Standard-A',
};

export const TTS_LANGUAGE_CODE_MAP: Record<string, string> = {
  'ar-SA': 'ar-XA',
};

export const STT_CONFIG = {
  model: 'chirp',
  encoding: 'WEBM_OPUS',
  sampleRateHertz: 48000,
  enableWordTimeOffsets: true,
  enableAutomaticPunctuation: true,
};

export const SUPPORTED_CASE_LANGUAGES = [
  { code: 'en-US', label: 'English (US)', sttLanguage: 'en' },
  { code: 'cs-CZ', label: 'Czech', sttLanguage: 'cs' },
] as const;

export type SupportedCaseLanguage = typeof SUPPORTED_CASE_LANGUAGES[number]['code'];

export function normalizeCaseLanguage(value: unknown): SupportedCaseLanguage {
  return SUPPORTED_CASE_LANGUAGES.some((language) => language.code === value)
    ? value as SupportedCaseLanguage
    : 'en-US';
}

export function caseLanguageFromDetected(value: unknown): SupportedCaseLanguage {
  const language = typeof value === 'string' ? value.toLowerCase() : '';
  if (language === 'cs' || language.startsWith('cs-') || language.includes('czech')) return 'cs-CZ';
  if (language === 'en' || language.startsWith('en-') || language.includes('english')) return 'en-US';
  return 'en-US';
}

export function sttLanguageForCaseLanguage(value: unknown) {
  if (!value || value === 'auto') return undefined;
  const code = normalizeCaseLanguage(value);
  return SUPPORTED_CASE_LANGUAGES.find((language) => language.code === code)?.sttLanguage ?? 'en';
}
