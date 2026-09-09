import assert from 'node:assert/strict';

import { resolveCanonicalPlatformUrl, resolvePlatformContactUrl } from './platformPresentation';

assert.equal(
  resolveCanonicalPlatformUrl('https://example.com/platform?utm_source=print#hero', 'https://fallback.test'),
  'https://example.com/platform',
  'configured canonical platform URL must strip query/hash',
);

assert.equal(
  resolveCanonicalPlatformUrl(undefined, 'https://renova.example'),
  'https://renova.example/platform',
  'runtime fallback must resolve the public /platform route',
);

assert.equal(
  resolveCanonicalPlatformUrl('javascript:alert(1)', 'https://renova.example'),
  'https://renova.example/platform',
  'unsafe configured URL must fall back to the trusted runtime origin',
);

assert.equal(
  resolveCanonicalPlatformUrl(undefined, 'javascript:alert(1)'),
  null,
  'unsafe runtime origin must fail closed',
);

assert.equal(
  resolvePlatformContactUrl('mailto:partners@example.com'),
  'mailto:partners@example.com',
  'mailto contact URL must be supported',
);

assert.equal(
  resolvePlatformContactUrl('javascript:alert(1)'),
  null,
  'unsafe contact URL must fail closed',
);
