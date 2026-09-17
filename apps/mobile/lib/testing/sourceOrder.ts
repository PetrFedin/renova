/**
 * Ordering assertions over source text that cannot pass by absence.
 *
 * The mobile suite checks a number of ordering contracts by reading the
 * implementation and comparing offsets:
 *
 *     must(service.indexOf('if current == status:') < service.indexOf('purchase.status = status'), …)
 *
 * `indexOf` returns -1 for a string that is not there, and -1 is below every
 * real index. So deleting the guard entirely *satisfies* the assertion that
 * the guard comes first — the test goes green on the exact regression it
 * exists to catch. The same shape appeared twelve times across nine files.
 *
 * These helpers require both strings to be present before comparing, and say
 * which one is missing when they are not.
 *
 * They assert on source text, which is a weak form of evidence: a rename
 * breaks them without anything being wrong. Where the property can be
 * exercised instead it should be — see
 * backend/tests/test_route_table_has_no_shadowed_routes.py for the routing
 * case and test_purchase_transition_integrity.py for the replay case. These
 * helpers are for the contracts that have no runtime surface here.
 */

function require_(source: string, needle: string, message: string): number {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error(`${message}: ${JSON.stringify(needle)} is not present at all`);
  return at;
}

/** `before` must appear, `after` must appear, and `before` must come first. */
export function mustPrecede(source: string, before: string, after: string, message: string): void {
  const first = require_(source, before, message);
  const second = require_(source, after, message);
  if (!(first < second)) {
    throw new Error(`${message}: ${JSON.stringify(before)} comes after ${JSON.stringify(after)}`);
  }
}

/** `needle` must occur somewhere after `anchor`, and `anchor` must exist. */
export function mustFollow(source: string, anchor: string, needle: string, message: string): void {
  const at = require_(source, anchor, message);
  if (source.indexOf(needle, at + anchor.length) < 0) {
    throw new Error(`${message}: ${JSON.stringify(needle)} never occurs after ${JSON.stringify(anchor)}`);
  }
}

/**
 * Whether `before` comes first — for the cases that assert the *negative*.
 * Both strings must exist; an absent one is a broken test, not a passing one.
 */
export function precedes(source: string, before: string, after: string, message: string): boolean {
  const first = require_(source, before, message);
  const second = require_(source, after, message);
  return first < second;
}
