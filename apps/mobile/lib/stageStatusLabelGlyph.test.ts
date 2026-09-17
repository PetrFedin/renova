/**
 * Stripping the status glyph must not break the emoji.
 *
 * `stageStatusLabel` removed a leading status glyph with a character class that
 * had no `u` flag. Without it 🔨 (U+1F528) is two code units, so the class
 * matched only the high surrogate and left the low one in the string:
 *
 *     '🔨 В работе'  ->  '\udd28 В работе'
 *
 * Which renders as "� В работе" wherever a stage is in progress. The same
 * expression appeared a second time in ScheduleDayDetail.
 *
 * Found by ESLint's no-misleading-character-class on its first run over this
 * codebase — the project had no linter before.
 */
import { STAGE_STATUS_LABEL, stageStatusLabel } from '@/constants/labels';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const LONE_SURROGATE = /[\uD800-\uDFFF]/;

// --- every label survives the strip -----------------------------------------

for (const [status, label] of Object.entries(STAGE_STATUS_LABEL)) {
  const stripped = stageStatusLabel(status);

  must(
    !LONE_SURROGATE.test(stripped),
    `${status}: stripping the glyph from ${JSON.stringify(label)} left a lone surrogate: ${JSON.stringify(stripped)}`,
  );
  must(
    stripped.length > 0,
    `${status}: the label must not be emptied by stripping its glyph`,
  );
  must(
    !/^[\s✓⏳🔨○]/u.test(stripped),
    `${status}: the leading glyph and its spacing must be gone, got ${JSON.stringify(stripped)}`,
  );
}

// --- the specific case that was broken --------------------------------------

must(
  stageStatusLabel('active') === 'В работе',
  `the in-progress label is the one that broke; got ${JSON.stringify(stageStatusLabel('active'))}`,
);
must(stageStatusLabel('done') === 'Сдан', 'done label');
must(stageStatusLabel('review') === 'На приёмке', 'review label');
must(stageStatusLabel('planned') === 'Запланирован', 'planned label');

// --- an unknown status passes through ---------------------------------------

must(
  stageStatusLabel('something-new') === 'something-new',
  'an unmapped status must be returned unchanged, not blanked',
);

console.log('stageStatusLabelGlyph.test OK');
