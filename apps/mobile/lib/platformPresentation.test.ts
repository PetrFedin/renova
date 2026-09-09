import { resolveCanonicalPlatformUrl, resolvePlatformContactUrl } from './platformPresentation';

console.assert(
  resolveCanonicalPlatformUrl('https://example.com/platform?utm_source=print#hero', 'https://fallback.test') ===
    'https://example.com/platform',
  'configured canonical platform URL must strip query/hash',
);

console.assert(
  resolveCanonicalPlatformUrl(undefined, 'https://renova.example') === 'https://renova.example/platform',
  'runtime fallback must resolve the public /platform route',
);

console.assert(
  resolveCanonicalPlatformUrl('javascript:alert(1)', 'https://renova.example') === 'https://renova.example/platform',
  'unsafe configured URL must fall back to the trusted runtime origin',
);

console.assert(
  resolveCanonicalPlatformUrl(undefined, 'javascript:alert(1)') === null,
  'unsafe runtime origin must fail closed',
);

console.assert(
  resolvePlatformContactUrl('mailto:partners@example.com') === 'mailto:partners@example.com',
  'mailto contact URL must be supported',
);

console.assert(
  resolvePlatformContactUrl('javascript:alert(1)') === null,
  'unsafe contact URL must fail closed',
);
