import fs from 'node:fs';

const index = fs.readFileSync('apps/mobile/app/index.tsx', 'utf8');
const entry = fs.readFileSync('apps/mobile/lib/osEntry.ts', 'utf8');
const bootstrap = fs.readFileSync('apps/mobile/lib/sessionBootstrap.ts', 'utf8');
const seed = fs.readFileSync('backend/app/e2e_seed.py', 'utf8');

function must(condition, message) {
  if (!condition) throw new Error(message);
}

must(index.includes('EXPO_PUBLIC_REVIEW_MODE'), 'review root must be explicit');
must(index.includes("setHref('/onboarding/role')"), 'review root must open role selection');
must(bootstrap.includes('!REVIEW_MODE_ENABLED &&'), 'review must disable iframe autologin');
must(entry.includes("REVIEW_MODE_ENABLED && pending === '1'"), 'review demo role must open project picker');
must(seed.split('await ensure_demo_users(db)').length - 1 >= 2, 'pristine review seed must reconcile the full project set');

console.log('review stand contract: ok');
