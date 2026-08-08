import type { UserRole } from '@/lib/api';

export type TeamMemberRole = 'owner' | 'foreman' | 'member' | 'viewer';
export type TeamAccessState = 'not_applicable' | 'solo' | TeamMemberRole | 'unresolved';

export type TeamAccess = {
  state: TeamAccessState;
  role: TeamMemberRole | null;
  readOnly: boolean;
  ownerLike: boolean;
};

type TeamSnapshot = {
  members?: { user_id: string; role?: string | null }[] | null;
} | null;

const VALID_TEAM_ROLES = new Set<TeamMemberRole>(['owner', 'foreman', 'member', 'viewer']);

export const UNRESOLVED_TEAM_ACCESS: TeamAccess = Object.freeze({
  state: 'unresolved',
  role: null,
  readOnly: true,
  ownerLike: false,
});

export const NOT_APPLICABLE_TEAM_ACCESS: TeamAccess = Object.freeze({
  state: 'not_applicable',
  role: null,
  readOnly: false,
  ownerLike: false,
});

const SOLO_TEAM_ACCESS: TeamAccess = Object.freeze({
  state: 'solo',
  role: null,
  readOnly: false,
  ownerLike: true,
});

export function parseTeamMemberRole(role: unknown): TeamMemberRole | null {
  return typeof role === 'string' && VALID_TEAM_ROLES.has(role as TeamMemberRole)
    ? (role as TeamMemberRole)
    : null;
}

/**
 * Resolve the contractor team boundary without inventing permissions.
 * A successful `GET /teams/me` returning null means a legitimate solo contractor.
 * A failed lookup, malformed role, or team without this user's membership is unknown
 * authorization state and must therefore be read-only.
 */
export function resolveTeamAccess(input: {
  userId: string;
  userRole: UserRole;
  team: TeamSnapshot;
  lookupFailed?: boolean;
}): TeamAccess {
  if (input.userRole !== 'contractor') return NOT_APPLICABLE_TEAM_ACCESS;
  if (input.lookupFailed) return UNRESOLVED_TEAM_ACCESS;
  if (input.team === null) return SOLO_TEAM_ACCESS;

  const self = input.team.members?.find((member) => member.user_id === input.userId);
  const role = parseTeamMemberRole(self?.role);
  if (!role) return UNRESOLVED_TEAM_ACCESS;

  return {
    state: role,
    role,
    readOnly: role === 'viewer',
    ownerLike: role === 'owner',
  };
}
