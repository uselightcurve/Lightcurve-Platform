import type { ProviderId } from '@/lib/integrations';

type ProviderLogoProps = {
  provider: ProviderId | string;
  className?: string;
};

const iconClass = 'h-4 w-4 shrink-0';

export function ProviderLogo({ provider, className = iconClass }: ProviderLogoProps) {
  if (provider === 'vapi') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#eef2ff" />
        <path d="M7 7.5l4.1 9 5.9-9" stroke="#2f5ae0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (provider === 'retell') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#ecfdf5" />
        <path d="M8 16V8h5.2a3 3 0 010 6H10.8" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.2 14l3 2.8" stroke="#047857" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (provider === 'elevenlabs') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#f8fafc" />
        <path d="M8 7v10M12 7v10M16 7v10" stroke="#111827" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
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

  if (provider === 'pipecat') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="#fff7ed" />
        <path d="M7 9h5a3 3 0 010 6H9v3" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 11l2-2m-2 6l2 2" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" />
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
