import fs from 'node:fs';

const index = fs.readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('./osEntry.ts', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('./sessionBootstrap.ts', import.meta.url), 'utf8');

function must(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

must(index.includes("EXPO_PUBLIC_REVIEW_MODE"), 'review root must be explicit');
must(index.includes("setHref('/onboarding/role')"), 'review root must start at role selection');
must(bootstrap.includes('!REVIEW_MODE_ENABLED &&'), 'review mode must disable iframe autologin');
must(entry.includes("REVIEW_MODE_ENABLED && pending === '1'"), 'review demo login must lead to project picker');
must(entry.includes("renova_detail_quiz_done', '1'"), 'review stand must preselect standard detail level');

console.log('review mode integrity: ok');
