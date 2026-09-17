/**
 * A direction stated twice is a direction reversed.
 *
 * The budget summary named the direction in the label and repeated it in the
 * value, so a project with nothing spent read:
 *
 *     Экономия  −185 938 ₽
 *
 * in green, under «В пределах плана». Observed on the running app.
 */
import { formatDeviationLabel, formatDeviationValue } from './budgetDeviationLabel';

const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const digits = (s: string) => s.replace(/[^\d]/g, '');

// --- the labels name the direction ------------------------------------------

must(formatDeviationLabel(185938) === 'Перерасход', 'over plan is Перерасход');
must(formatDeviationLabel(-185938) === 'Экономия', 'under plan is Экономия');
must(formatDeviationLabel(0) === 'Отклонение', 'no deviation is neutral');

// --- the value never repeats it ---------------------------------------------

const saved = formatDeviationValue(-185938);
must(
  !saved.includes('−') && !saved.includes('-'),
  `a saving must not be written as a negative; got ${JSON.stringify(saved)}`,
);
must(
  digits(saved) === digits(formatDeviationValue(185938)),
  'the same magnitude either side of plan must print the same number',
);

const over = formatDeviationValue(185938);
must(
  !over.includes('+'),
  `the label already says Перерасход; got ${JSON.stringify(over)}`,
);

// --- the pair a user actually reads -----------------------------------------

for (const deviation of [-185938, -1, 0, 1, 185938]) {
  const line = `${formatDeviationLabel(deviation)} ${formatDeviationValue(deviation)}`;
  must(
    !/Экономия\s*[−-]/.test(line),
    `a saving must never be rendered with a minus: ${JSON.stringify(line)}`,
  );
  must(
    !/Перерасход\s*[−-]/.test(line),
    `an overspend must never be rendered with a minus: ${JSON.stringify(line)}`,
  );
}

// --- degenerate inputs do not reach the screen ------------------------------
//
// Intl formats these in Russian, so a check for "NaN" or "Infinity" would pass
// no matter what: NaN renders as «не число ₽» and Infinity as «∞ ₽». The
// assertion has to name the expected output instead.

const zero = formatDeviationValue(0);
for (const bad of [NaN, Infinity, -Infinity]) {
  const value = formatDeviationValue(bad);
  must(
    value === zero,
    `a non-finite deviation must render as ${JSON.stringify(zero)}; got ${JSON.stringify(value)}`,
  );
}

// --- the screen uses the helpers rather than its own formatting -------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const section = readFileSync(
  join(__dirname, '..', '..', 'components', 'screens', 'budget', 'BudgetSummarySection.tsx'),
  'utf8',
);
must(
  section.includes('formatDeviationLabel(view.deviation)') &&
    section.includes('formatDeviationValue(view.deviation)'),
  'the budget summary must format its deviation through the shared helpers',
);
must(
  !/`−\$\{formatRub\(Math\.abs\(view\.deviation\)\)\}`/.test(section),
  'the inline negative formatting must not come back',
);

console.log('budgetDeviationLabel.test OK');
