/** Единый контракт capability интеграций (SoT = backend health). */
export type ServiceMode = 'live' | 'sandbox' | 'local' | 'demo' | 'off' | 'error';

export type ServiceCapability = {
  available: boolean;
  mode: ServiceMode;
  provider?: string | null;
  configured: boolean;
  healthy: boolean;
  message?: string | null;
  checkedAt?: string | null;
  checked_at?: string | null;
  /** OCR: можно ли запускать classify */
  run_allowed?: boolean;
  /** My Nalog extras */
  oauth_configured?: boolean;
  connection_available?: boolean;
  dev_bypass_available?: boolean;
};

export function capabilityModeLabel(mode: ServiceMode | string | null | undefined): string {
  const m = (mode || 'off').toLowerCase();
  switch (m) {
    case 'live':
      return 'LIVE';
    case 'sandbox':
      return 'SANDBOX';
    case 'local':
      return 'LOCAL';
    case 'demo':
      return 'DEMO';
    case 'error':
      return 'ERROR';
    case 'off':
    default:
      return 'OFF';
  }
}

export function normalizeCapability(
  raw: (Partial<ServiceCapability> & { mode?: string }) | null | undefined,
): ServiceCapability {
  const mode = (raw?.mode || 'off') as ServiceMode;
  return {
    available: Boolean(raw?.available),
    mode,
    provider: raw?.provider ?? null,
    configured: Boolean(raw?.configured),
    healthy: Boolean(raw?.healthy),
    message: raw?.message ?? null,
    checkedAt: raw?.checkedAt ?? raw?.checked_at ?? null,
    checked_at: raw?.checked_at ?? raw?.checkedAt ?? null,
    run_allowed: raw?.run_allowed,
    oauth_configured: raw?.oauth_configured,
    connection_available: raw?.connection_available,
    dev_bypass_available: raw?.dev_bypass_available,
  };
}
