import type { ProviderId } from '@/lib/integrations';

type ProviderLogoProps = {
  provider: ProviderId | string;
  className?: string;
};

const iconClass = 'h-5 w-5 shrink-0';

const logoSrc: Partial<Record<ProviderId, string>> = {
  vapi: '/provider-logos/vapi.svg',
  retell: '/provider-logos/retell.svg',
  elevenlabs: '/provider-logos/elevenlabs.png',
  pipecat: '/provider-logos/pipecat.png',
};

export function ProviderLogo({ provider, className = iconClass }: ProviderLogoProps) {
  const src = logoSrc[provider as ProviderId];
  if (src) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className}`} aria-hidden="true">
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      </span>
    );
  }

  if (provider === 'livekit') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#eff6ff" />
        <path d="M7 13.5l3.2-3.2 2.5 2.5L17 8.5" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#f8fafc" />
      <path d="M8 8l8 4-8 4V8z" stroke="#475467" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProviderName({ provider, name }: { provider: ProviderId | string; name: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ProviderLogo provider={provider} />
      <span>{name}</span>
    </span>
  );
}
