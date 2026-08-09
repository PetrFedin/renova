/** Safe persisted user identity for cold-start/offline session recovery. */
import type { User, UserRole } from '@/lib/api';

export const SESSION_USER_SNAPSHOT_KEY = 'renova_user_snapshot_v1';

type PersistedUser = Omit<User, 'access_token' | 'refresh_token' | 'token_type'>;

type Envelope = {
  version: 1;
  user: PersistedUser;
};

function isRole(value: unknown): value is UserRole {
  return value === 'customer' || value === 'contractor';
}

/** JWT/refresh credentials are deliberately excluded from the snapshot. */
export function serializeSessionUserSnapshot(user: User): string {
  const { access_token: _access, refresh_token: _refresh, token_type: _tokenType, ...safeUser } = user;
  const envelope: Envelope = { version: 1, user: safeUser };
  return JSON.stringify(envelope);
}

/**
 * Parse only the minimum trusted shape needed to restore identity offline.
 * Expected id/role bind the snapshot to the separately persisted session keys.
 */
export function parseSessionUserSnapshot(
  raw: string | null | undefined,
  expected?: { id?: string | null; role?: string | null },
): User | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (parsed.version !== 1 || !parsed.user || typeof parsed.user !== 'object') return null;
    const user = parsed.user as Partial<PersistedUser>;
    if (typeof user.id !== 'string' || !user.id.trim()) return null;
    if (!isRole(user.role)) return null;
    if (typeof user.phone !== 'string') return null;
    if (user.full_name !== null && typeof user.full_name !== 'string') return null;
    if (user.inn !== null && typeof user.inn !== 'string') return null;
    if (typeof user.npd_verified !== 'boolean') return null;
    if (expected?.id && user.id !== expected.id) return null;
    if (expected?.role && user.role !== expected.role) return null;

    return user as User;
  } catch {
    return null;
  }
}
