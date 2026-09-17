/**
 * Navigation must default to the role the app is actually in.
 *
 * `pushOsNav`, `replaceOsNav` and `toOsRoute` defaulted their role argument to
 * the literal `'customer'`, and 59 of the 170 navigation calls in the app omit
 * it. A contractor hitting any of those was routed into the customer route
 * group.
 *
 * Nothing fails loudly when that happens: `(customer)/(tabs)` and
 * `(contractor)/(tabs)` declare the same nine leaf routes and expo-router
 * groups are invisible in the URL, so `/profile` is simply ambiguous. Observed
 * live in the opposite direction — ContractorProfileScreen mounted for a
 * customer account, with `GET /api/v1/teams/me` and
 * `GET /api/v1/contractors/me/profile` both answering 403.
 */
import { getCurrentOsRole, hasResolvedOsRole, setCurrentOsRole } from './currentOsRole';
// pushOsNav imports expo-router, which cannot load outside the app runtime, so
// the routing half is exercised through resolvePushLink — the function
// toOsRoute delegates to — with the same ambient default applied.
import { resolvePushLink } from './pushLinks';

const toOsRoute = (target: string, returnTo?: string, role = getCurrentOsRole()) => {
  const resolved = resolvePushLink(target, returnTo, role);
  return resolved ? { pathname: resolved.pathname } : { pathname: target };
};

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

// --- the registry itself -----------------------------------------------------

setCurrentOsRole(null);
must(hasResolvedOsRole() === false, 'no role is resolved before sign-in');
must(
  getCurrentOsRole() === 'customer',
  'before sign-in the historical default is kept, so behaviour is never worse',
);

setCurrentOsRole('contractor');
must(getCurrentOsRole() === 'contractor', 'contractor must be stored');
must(hasResolvedOsRole() === true, 'a real role is now resolved');

setCurrentOsRole('customer');
must(getCurrentOsRole() === 'customer', 'customer must be stored');

setCurrentOsRole('something-else' as never);
must(
  getCurrentOsRole() === 'customer' && hasResolvedOsRole() === false,
  'an unknown value must not be trusted as a role',
);

// --- the defect this exists for ---------------------------------------------

setCurrentOsRole('contractor');
const asContractor = toOsRoute('/profile');
must(
  asContractor.pathname.includes('(contractor)'),
  `a contractor calling toOsRoute without a role must stay in the contractor group, got ${asContractor.pathname}`,
);

setCurrentOsRole('customer');
const asCustomer = toOsRoute('/profile');
must(
  asCustomer.pathname.includes('(customer)'),
  `a customer must stay in the customer group, got ${asCustomer.pathname}`,
);

// --- an explicit argument still wins ----------------------------------------

setCurrentOsRole('customer');
const explicitContractor = toOsRoute('/profile', undefined, 'contractor');
must(
  explicitContractor.pathname.includes('(contractor)'),
  'an explicitly passed role must override the ambient one',
);

setCurrentOsRole('contractor');
const explicitCustomer = toOsRoute('/profile', undefined, 'customer');
must(
  explicitCustomer.pathname.includes('(customer)'),
  'an explicitly passed role must override the ambient one',
);

// --- the two route groups really do collide ---------------------------------

must(
  asContractor.pathname !== asCustomer.pathname,
  'the two roles must resolve to different routes; if they did not, the ambiguity would be unobservable',
);

// --- the default is actually bound in the navigation helpers -----------------
//
// The routing assertions above go through resolvePushLink because pushOsNav
// imports expo-router, which cannot load outside the app runtime. So the
// binding itself is asserted on the source: without this, the ambient role
// could be correct while pushOsNav still defaulted to the literal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const navSource = readFileSync(join(__dirname, 'pushOsNav.ts'), 'utf8');

for (const fn of ['toOsRoute', 'pushOsNav', 'replaceOsNav']) {
  const signature = navSource.slice(navSource.indexOf(`export function ${fn}(`));
  const head = signature.slice(0, signature.indexOf(')') + 1);
  must(
    head.includes('getCurrentOsRole()'),
    `${fn} must default its role to the live one, got: ${head.replace(/\s+/g, ' ')}`,
  );
  must(
    !/role: OsRole = 'customer'/.test(head),
    `${fn} must not default to the literal 'customer'`,
  );
}

console.log('navigationRoleDefault.test OK');
