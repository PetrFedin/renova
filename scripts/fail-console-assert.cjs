const nativeAssert = console.assert.bind(console);

function formatAssertPart(part) {
  if (typeof part === 'string') return part;
  try {
    const encoded = JSON.stringify(part);
    return encoded === undefined ? String(part) : encoded;
  } catch {
    return String(part);
  }
}

console.assert = (condition, ...args) => {
  if (condition) return;
  const message = args.length
    ? args.map(formatAssertPart).join(' ')
    : 'console.assert(false)';
  const error = new Error(`Assertion failed: ${message}`);
  error.name = 'AssertionError';
  throw error;
};

module.exports = { nativeAssert };
