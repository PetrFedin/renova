/**
 * The ordering helpers must fail on absence, which is the whole point.
 *
 * The shape they replace — `s.indexOf(a) < s.indexOf(b)` — goes green when `a`
 * is deleted, because a missing string is -1 and -1 is below every real index.
 * A test that passes precisely when the thing it guards is removed is worse
 * than no test, so this pins the behaviour directly rather than relying on
 * each call site to have been converted correctly.
 */
import { mustFollow, mustPrecede, precedes } from './sourceOrder';

const SOURCE = 'alpha beta gamma';

const throws = (run: () => unknown, expected: RegExp, what: string) => {
  let message: string | null = null;
  try {
    run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === null) throw new Error(`${what}: expected a throw, got none`);
  if (!expected.test(message)) throw new Error(`${what}: message was ${JSON.stringify(message)}`);
};

const doesNotThrow = (run: () => unknown, what: string) => {
  run();
};

// --- the ordered case still passes -------------------------------------------

doesNotThrow(() => mustPrecede(SOURCE, 'alpha', 'gamma', 'ordered'), 'mustPrecede ordered');
doesNotThrow(() => mustFollow(SOURCE, 'alpha', 'gamma', 'ordered'), 'mustFollow ordered');
if (precedes(SOURCE, 'alpha', 'gamma', 'ordered') !== true) throw new Error('precedes ordered');
if (precedes(SOURCE, 'gamma', 'alpha', 'reversed') !== false) throw new Error('precedes reversed');

// --- the wrong order is reported ---------------------------------------------

throws(
  () => mustPrecede(SOURCE, 'gamma', 'alpha', 'reversed'),
  /comes after/,
  'mustPrecede reversed',
);
throws(
  () => mustFollow(SOURCE, 'gamma', 'alpha', 'reversed'),
  /never occurs after/,
  'mustFollow reversed',
);

// --- absence is a failure, not a pass ----------------------------------------
//
// This is the regression the helpers exist for. Under the old
// `indexOf < indexOf` form, the first of these five passed.

throws(
  () => mustPrecede(SOURCE, 'missing', 'gamma', 'absent first'),
  /"missing" is not present at all/,
  'mustPrecede with the first string gone',
);
throws(
  () => mustPrecede(SOURCE, 'alpha', 'missing', 'absent second'),
  /"missing" is not present at all/,
  'mustPrecede with the second string gone',
);
throws(
  () => mustFollow(SOURCE, 'missing', 'gamma', 'absent anchor'),
  /"missing" is not present at all/,
  'mustFollow with the anchor gone',
);
throws(
  () => mustFollow(SOURCE, 'alpha', 'missing', 'absent needle'),
  /never occurs after/,
  'mustFollow with the needle gone',
);
throws(
  () => precedes(SOURCE, 'missing', 'gamma', 'absent'),
  /"missing" is not present at all/,
  'precedes with a string gone',
);

// --- an occurrence before the anchor does not satisfy mustFollow -------------

throws(
  () => mustFollow('clear(); guard; more', 'guard', 'clear();', 'only before'),
  /never occurs after/,
  'mustFollow must not accept an earlier occurrence',
);

console.log('sourceOrder.test OK');
