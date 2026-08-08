let threw = false;

try {
  console.assert(false, 'fail-closed probe');
} catch (error) {
  threw = error instanceof Error && error.name === 'AssertionError' && error.message.includes('fail-closed probe');
}

if (!threw) {
  throw new Error('console.assert(false) must throw under the mobile:test fail-closed preload');
}

console.assert(true, 'true assertions remain no-ops');
console.log('consoleAssertFailClosed.test OK');
