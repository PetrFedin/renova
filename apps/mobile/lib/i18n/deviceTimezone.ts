/**
 * IANA timezone устройства (не timezone сервера).
 * Используется для «сегодня» в TaskCounters / calendar badge.
 */
export function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch {
    /* ignore */
  }
  return 'Europe/Moscow';
}
