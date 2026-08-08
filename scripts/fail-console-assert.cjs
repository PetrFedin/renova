const nativeAssert = console.assert.bind(console);

console.assert = (condition, ...args) => {
  if (condition) return;
  const message = args.length
    ? args.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')
    : 'console.assert(false)';
  const error = new Error(`Assertion failed: ${message}`);
  error.name = 'AssertionError';
  throw error;
};

module.exports = { nativeAssert };
