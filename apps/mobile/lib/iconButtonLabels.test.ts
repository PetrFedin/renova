/**
 * An icon-only button must say what it does, in words.
 *
 * Two ways to get this wrong, both found in the running app by reading the
 * rendered accessibility tree rather than the source:
 *
 *   accessibilityLabel={name}   ProjectCardLifecycleIcons passed the Ionicons
 *                               glyph straight through, so VoiceOver read
 *                               "archive-outline", "trash-outline",
 *                               "close-circle-outline". Two of the four are
 *                               destructive and one deletes permanently — the
 *                               one user who cannot see the icon was told the
 *                               least about what the button would do.
 *
 *   no label at all             ScratchpadLineRow's checkbox announced
 *                               "флажок, отмечен" and nothing about which
 *                               line, because the row's text is in a sibling
 *                               Pressable.
 *
 * This walks every component and fails on either shape. It is a source check,
 * so it is only as good as the patterns below; it exists to stop a known
 * regression returning, not to prove the app is accessible.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS = join(__dirname, '..', 'components');

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

/**
 * Source with comments removed.
 *
 * Without this the check trips on its own documentation: the component that
 * was fixed explains the defect by quoting `accessibilityLabel={name}`, and a
 * plain search finds that quote. A test that fails on a comment describing a
 * fixed bug is a test that teaches people not to document fixes.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

const files = walk(COMPONENTS);
must(files.length > 50, `expected to find the component tree, got ${files.length} files`);

// --- the glyph name must not be the label ------------------------------------

const glyphAsLabel: string[] = [];
for (const path of files) {
  const source = codeOnly(readFileSync(path, 'utf8'));
  // A variable that holds a glyph, not a sentence.
  if (/accessibilityLabel=\{\s*(name|icon|iconName)\s*\}/.test(source)) {
    glyphAsLabel.push(path.slice(path.indexOf('apps/mobile')));
  }
  // A literal that looks like an Ionicons glyph rather than prose.
  const literal = source.match(/accessibilityLabel="([a-z0-9]+(?:-[a-z0-9]+)*(?:-outline|-sharp))"/);
  if (literal) glyphAsLabel.push(`${path.slice(path.indexOf('apps/mobile'))} (${literal[1]})`);
}

must(
  glyphAsLabel.length === 0,
  `an Ionicons glyph name is being read aloud as a button label:\n  ${glyphAsLabel.join('\n  ')}`,
);

// --- an icon-only pressable must carry a label -------------------------------

const PRESSABLE = /<Pressable\b(?:(?!<\/Pressable>|<Pressable\b)[\s\S])*?<\/Pressable>/g;

const unlabelled: string[] = [];
for (const path of files) {
  const source = codeOnly(readFileSync(path, 'utf8'));
  for (const match of source.match(PRESSABLE) ?? []) {
    const hasIcon = /<Ionicons\b/.test(match);
    const hasText = /<Text[\s>]/.test(match);
    const hasLabel = /accessibility(Label|LabelledBy)=/.test(match);
    // Children passed in from outside can carry their own text, so only a
    // Pressable whose visible content is an icon and nothing else is judged.
    if (hasIcon && !hasText && !hasLabel && !/\{children\}/.test(match)) {
      const line = source.slice(0, source.indexOf(match)).split('\n').length;
      unlabelled.push(`${path.slice(path.indexOf('apps/mobile'))}:${line}`);
    }
  }
}

must(
  unlabelled.length === 0,
  `an icon-only button has no accessibilityLabel, so it is announced by its role alone:\n  ${unlabelled.join('\n  ')}`,
);

// --- the two that were fixed stay fixed --------------------------------------

const lifecycle = readFileSync(join(COMPONENTS, 'renova', 'ProjectCardLifecycleIcons.tsx'), 'utf8');
for (const phrase of [
  'Архивировать объект',
  'Переместить объект в корзину',
  'Вернуть объект из архива',
  'Восстановить объект из корзины',
  'Удалить объект навсегда',
]) {
  must(lifecycle.includes(phrase), `the lifecycle icons must name their action: ${phrase}`);
}

console.log('iconButtonLabels.test OK');
