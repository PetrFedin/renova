/**
 * The role the app is currently acting as, readable outside React.
 *
 * `pushOsNav`, `replaceOsNav` and `toOsRoute` take the role as their third
 * argument and defaulted it to the literal `'customer'`. 59 of the 170
 * navigation calls in the app do not pass it, so a contractor hitting any of
 * those was routed into the customer route group.
 *
 * Nothing fails loudly when that happens: `(customer)/(tabs)` and
 * `(contractor)/(tabs)` declare the same nine leaf routes (index, profile,
 * budget, calendar, chat, object, repair, [legacyTab], _layout) and expo-router
 * groups are invisible in the URL, so `/profile` is simply ambiguous. The user
 * lands in the other role's interface and is offered actions the backend will
 * always reject — observed live as ContractorProfileScreen mounting for a
 * customer account, with `GET /api/v1/teams/me` and
 * `GET /api/v1/contractors/me/profile` both answering 403.
 *
 * Fixing 59 call sites by hand means knowing the correct role at each one.
 * Reading the role the app is actually in fixes all of them at once and leaves
 * every explicit argument working exactly as before.
 *
 * This is a deliberate module-level value rather than context: the navigation
 * helpers are plain functions called from event handlers, not hooks.
 */
import type { OsRole } from '@/constants/osSections';

/** Matches the previous hard-coded default, so behaviour is never worse. */
const FALLBACK_ROLE: OsRole = 'customer';

let currentRole: OsRole | null = null;

export function setCurrentOsRole(role: OsRole | string | null | undefined): void {
  currentRole = role === 'contractor' ? 'contractor' : role === 'customer' ? 'customer' : null;
}

/**
 * The active role, or the historical default before sign-in has resolved.
 */
export function getCurrentOsRole(): OsRole {
  return currentRole ?? FALLBACK_ROLE;
}

/** Whether a real role has been established (tests and diagnostics). */
export function hasResolvedOsRole(): boolean {
  return currentRole !== null;
}
