export function isNativeNotificationPlatform(platform: string): boolean {
  return platform === 'ios' || platform === 'android';
}

export function shouldScheduleNativeConflictNotification(
  platform: string,
  conflicts: number,
): boolean {
  return isNativeNotificationPlatform(platform)
    && Number.isFinite(conflicts)
    && conflicts > 0;
}
