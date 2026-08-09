import { readFileSync } from 'node:fs';
import './teamJoinFlow.test';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const context = readFileSync('apps/mobile/lib/context/RenovaContext.tsx', 'utf8');
const helper = readFileSync('apps/mobile/lib/domain/teamAccess.ts', 'utf8');
const roleScreen = readFileSync('apps/mobile/app/onboarding/_screens/role.tsx', 'utf8');
const joinHelper = readFileSync('apps/mobile/lib/teamJoinFlow.ts', 'utf8');

must(
  context.includes('const effectiveReadOnly = readOnly || teamAccess.readOnly;'),
  'context must compose project and team restrictions instead of letting either overwrite the other',
);
must(
  context.includes('setTeamAccess(UNRESOLVED_TEAM_ACCESS);'),
  'contractor team lookup must become read-only while unresolved and on failure',
);
must(
  context.includes("reportError('renovaContext.teamAccess'"),
  'team lookup failures must remain observable',
);
must(
  context.includes('readOnly: effectiveReadOnly,'),
  'consumers must receive the composed read-only result',
);
must(
  context.includes('&& teamAccess.ownerLike'),
  'owner capability must come from resolved team access, not an absent role',
);
must(
  !context.includes("me?.role || 'owner'"),
  'missing membership must never be promoted to owner',
);
must(
  !/api\.getTeam\([^)]+\)[\s\S]{0,260}catch\s*\{\s*setReadOnly\(false\)/.test(context),
  'team API failure must never clear read-only mode',
);
must(
  helper.includes("if (input.team === null) return SOLO_TEAM_ACCESS;"),
  'successful no-team response must stay a valid solo-contractor state',
);
must(
  helper.includes('if (!role) return UNRESOLVED_TEAM_ACCESS;'),
  'unknown or missing team membership must fail closed',
);
must(
  helper.includes("readOnly: role === 'viewer'"),
  'viewer membership must remain explicitly read-only',
);

must(
  roleScreen.includes('setPendingTeamJoinUserId(id);'),
  'team invite flow must remember authenticated user id so join retry never consumes another OTP',
);
must(
  roleScreen.includes('requireSuccessfulTeamJoin(joined)'),
  'team invite flow must validate the business result instead of trusting HTTP success',
);
must(
  roleScreen.includes("reportError('onboarding.teamJoin'"),
  'team invite failures must remain observable',
);
must(
  roleScreen.includes("reportError('onboarding.teamJoin.refreshAccess'"),
  'post-commit team access reconciliation failures must remain observable',
);
must(
  roleScreen.includes('Продолжить без вступления'),
  'failed invite join must expose an explicit escape path instead of a dead end',
);
must(
  !roleScreen.includes('catch { /* team */ }'),
  'team invite join must never silently swallow failure and navigate as success',
);
must(
  joinHelper.includes('value.ok !== true'),
  'business-level join failure must fail closed',
);
must(
  joinHelper.includes("typeof value.team_id !== 'string'"),
  'malformed success without committed team id must fail closed',
);

console.log('teamAccessFailClosed.w178.test OK');
