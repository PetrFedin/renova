#!/usr/bin/env node
/**
 * Enforce the design canon that already exists but nothing checked.
 *
 * `.cursor/rules/renova-design-system.mdc` is `alwaysApply: true` and lists
 * what is forbidden in mobile UI. Nothing verified it, so the rules drifted:
 * 183 local hex literals across 100 files, and 48 pictographic emoji standing
 * in for icons — including `💬`, `🔗` and `✕` used as tappable controls with no
 * accessible label, which a screen reader announces by emoji name.
 *
 * Ratcheted like the rest of this repository (npm audit, mobile typecheck,
 * backend lint): current counts are recorded, they may only shrink, and a new
 * violation fails the build. Nothing is auto-rewritten.
 *
 *   node scripts/check-mobile-design-system.mjs            # enforce
 *   node scripts/check-mobile-design-system.mjs --list     # what and where
 *   node scripts/check-mobile-design-system.mjs --update   # re-record
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MOBILE = join(REPO_ROOT, 'apps/mobile');
const BASELINE = join(REPO_ROOT, 'scripts', 'mobile-design-baseline.json');

// Tokens live here by design; these directories define the palette rather than
// hard-coding around it.
const TOKEN_DIRS = ['constants', 'components/ui'];

const SCAN_DIRS = ['app', 'components', 'store', 'lib'];

/**
 * Emoji that are product content rather than a stand-in for an icon. A check
 * that flags these loses credibility and gets switched off, so each entry says
 * why it is not a violation.
 */
const EMOJI_ALLOWLIST = new Map([
  ['apps/mobile/lib/commentReactions.ts', 'reaction values persisted in the database'],
  ['apps/mobile/components/renova/chat/ChatThreadView.tsx#reactions', 'reaction picker values'],
  ['apps/mobile/components/screens/StageDetailScreen.tsx', 'reaction picker values'],
  ['apps/mobile/lib/domain/scratchpadLine.ts', 'parses the 🛒 prefix a user types'],
  ['apps/mobile/components/screens/ScratchpadScreen.tsx', 'hint and placeholder teaching that syntax'],
  ['apps/mobile/lib/chatPreview.ts', 'single-line list preview; an inline icon cannot be embedded in a string'],
  ['apps/mobile/components/renova/schedule/ScheduleDayDetail.tsx', 'regex that strips leading emoji, does not render one'],
]);

function isAllowlisted(relativePath, line) {
  if (EMOJI_ALLOWLIST.has(relativePath)) return true;
  // ChatThreadView is only exempt on its reactions constant.
  if (relativePath.endsWith('chat/ChatThreadView.tsx')) return /REACTIONS\s*=/.test(line);
  return false;
}

/** Pictographic emoji. Deliberately excludes typographic marks the canon does
 *  not object to (✓ ✕ ★ ● · ⚠ →), which carry meaning in dense financial
 *  tables and are not a substitute for an icon component. */
const PICTOGRAPHIC = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/u;

const HEX = /#[0-9a-fA-F]{3,8}\b/;

/**
 * Engineering vocabulary that leaked into Russian user-facing copy, e.g.
 * "Предложить фиксацию без одностороннего lock" on the contractor's home card.
 *
 * Matched only inside a quoted string that also contains Cyrillic, and never
 * when the word follows `.` or `${` — otherwise `${snapshot.documents_total}`
 * and similar member names inside template literals dominate the output. A
 * first draft of this rule reported 12 hits of which 10 were exactly that, so
 * the boundary is deliberate.
 */
const JARGON = /(?<![.$}\w])\b(lock|outbox|payload|fallback|idempotency|deeplink|SoT|ACL)\b/;
const CYRILLIC = /[а-яА-ЯёЁ]/;
const QUOTED = /['"`]([^'"`\n]*)['"`]/g;

/**
 * routeRegistry.ts is developer-facing metadata, not UI copy: neither titleRu
 * nor descriptionRu is rendered by any component (verified by grep over app/
 * and components/), so "Legacy deeplink → бюджет" there documents a redirect
 * for a reader of the registry.
 */
const JARGON_EXEMPT_FILES = new Set(['apps/mobile/lib/routeRegistry.ts']);

function hasJargonInCopy(line) {
  for (const match of line.matchAll(QUOTED)) {
    const text = match[1];
    if (CYRILLIC.test(text) && JARGON.test(text)) return true;
  }
  return false;
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.expo') continue;
      walk(path, found);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function isTokenSource(relativePath) {
  return TOKEN_DIRS.some((dir) => relativePath.startsWith(`apps/mobile/${dir}/`));
}

function collect() {
  const findings = { 'local-hex': [], 'pictographic-emoji': [], 'jargon-in-copy': [] };

  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(MOBILE, dir))) {
      const rel = relative(REPO_ROOT, file);
      if (isTokenSource(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (HEX.test(line)) findings['local-hex'].push(`${rel}:${index + 1}`);
        if (PICTOGRAPHIC.test(line) && !isAllowlisted(rel, line)) {
          findings['pictographic-emoji'].push(`${rel}:${index + 1}`);
        }
        if (!JARGON_EXEMPT_FILES.has(rel) && hasJargonInCopy(line)) {
          findings['jargon-in-copy'].push(`${rel}:${index + 1}`);
        }
      });
    }
  }
  return findings;
}

const RULES = {
  'local-hex':
    'hard-coded colour. Use RenovaTheme.colors.* or uiTokens — a literal cannot follow the theme.',
  'pictographic-emoji':
    'emoji instead of an icon. Use Ionicons; an emoji has no accessible name, no size token and renders differently per platform.',
  'jargon-in-copy':
    'engineering vocabulary in Russian user-facing copy. Say what the user is doing, not how it is implemented.',
};

function main() {
  const mode = process.argv[2];
  const findings = collect();
  const counts = Object.fromEntries(
    Object.entries(findings).map(([rule, hits]) => [rule, hits.length]),
  );

  if (mode === '--list') {
    for (const [rule, hits] of Object.entries(findings)) {
      console.log(`\n${rule} (${hits.length}) — ${RULES[rule]}`);
      for (const hit of hits) console.log(`  ${hit}`);
    }
    return 0;
  }

  if (mode === '--update') {
    writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`baseline written: ${JSON.stringify(counts)}`);
    return 0;
  }

  const baseline = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : {};

  const failures = [];
  for (const [rule, count] of Object.entries(counts)) {
    const allowed = baseline[rule] ?? 0;
    if (count > allowed) {
      failures.push(`${rule}: ${allowed} -> ${count}. ${RULES[rule]}`);
    } else if (count < allowed) {
      console.log(`  ${rule} improved ${allowed} -> ${count} (run --update to lock it in)`);
    }
  }

  if (failures.length > 0) {
    console.error('\nDesign canon regression (.cursor/rules/renova-design-system.mdc):');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('\nSee which lines: node scripts/check-mobile-design-system.mjs --list');
    return 1;
  }

  console.log(`mobile design canon OK ${JSON.stringify(counts)}`);
  return 0;
}

process.exit(main());
