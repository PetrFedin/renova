'use strict';

// Node's console.assert only logs by default. Mobile source-contract tests rely on
// assertions as gates, so a false assertion must fail the process instead of
// printing a red-looking line followed by "test OK".
console.assert = (condition, ...args) => {
  if (condition) return;
  const message = args.length > 0
    ? args.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
    : 'console.assert failed';
  throw new Error(`Assertion failed: ${message}`);
};
