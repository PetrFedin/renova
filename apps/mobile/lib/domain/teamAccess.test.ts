import { resolveTeamAccess } from './teamAccess';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const userId = 'contractor-1';

const customer = resolveTeamAccess({ userId, userRole: 'customer', team: null });
must(customer.state === 'not_applicable' && !customer.readOnly, 'customer must not inherit contractor team restrictions');

const solo = resolveTeamAccess({ userId, userRole: 'contractor', team: null });
must(solo.state === 'solo' && !solo.readOnly && solo.ownerLike, 'successful no-team response must preserve solo contractor writes');

const owner = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: userId, role: 'owner' }] },
});
must(owner.role === 'owner' && !owner.readOnly && owner.ownerLike, 'team owner must remain writable');

const foreman = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: userId, role: 'foreman' }] },
});
must(foreman.role === 'foreman' && !foreman.readOnly && !foreman.ownerLike, 'foreman must be writable but not owner-like');

const member = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: userId, role: 'member' }] },
});
must(member.role === 'member' && !member.readOnly && !member.ownerLike, 'member must retain established write access');

const viewer = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: userId, role: 'viewer' }] },
});
must(viewer.role === 'viewer' && viewer.readOnly && !viewer.ownerLike, 'viewer must be read-only');

const missingMembership = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: 'someone-else', role: 'owner' }] },
});
must(missingMembership.state === 'unresolved' && missingMembership.readOnly, 'team without self membership must fail closed');

const unknownRole = resolveTeamAccess({
  userId,
  userRole: 'contractor',
  team: { members: [{ user_id: userId, role: 'super-admin' }] },
});
must(unknownRole.state === 'unresolved' && unknownRole.readOnly, 'unknown role must fail closed');

const lookupFailure = resolveTeamAccess({ userId, userRole: 'contractor', team: null, lookupFailed: true });
must(lookupFailure.state === 'unresolved' && lookupFailure.readOnly && !lookupFailure.ownerLike, 'team lookup failure must fail closed');

console.log('teamAccess.test OK');
