#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const calculation = read('docs/technical-spec/CALCULATION-REGISTRY.md');
const screens = read('docs/technical-spec/SCREEN-CONTRACT-CATALOG.md');
const screenSources = read('docs/technical-spec/SCREEN-SOURCE-SNAPSHOT.md');

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return crypto
    .createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

function requireBlobReference(doc, file) {
  const sha = gitBlobSha(read(file));
  assert.ok(
    doc.includes(sha),
    `technical specification annex is stale for ${file}; expected blob ${sha}`,
  );
}

for (const file of [
  'backend/app/services/budget_service.py',
  'apps/mobile/lib/domain/budgetFactReconcile.ts',
  'apps/mobile/lib/domain/budgetFactReconcile.test.ts',
  'apps/mobile/lib/domain/buildBudgetSummaryView.ts',
  'apps/mobile/lib/domain/resolveProjectProgress.ts',
  'apps/mobile/lib/domain/resolveProjectProgress.test.ts',
  'apps/mobile/lib/domain/scheduleExecutionStats.ts',
  'apps/mobile/lib/domain/scheduleExecutionStats.test.ts',
  'apps/mobile/lib/domain/aggregateBudgetByPeriod.ts',
  'apps/mobile/lib/domain/aggregatePortfolioBudget.ts',
  'apps/mobile/components/screens/OsSelectionsScreen.tsx',
]) {
  requireBlobReference(calculation, file);
}

for (const formulaToken of [
  'budget_planned =',
  'budget_spent = Σ(Expense.amount where Expense.status = confirmed)',
  'budget_actual_projection_mismatch',
  'delta   = listTotal - serverFact',
  'margin    = planned - spent',
  'weekStart = today - 6 calendar days',
  'periodPlanned = round(plannedTotal × overlap / projectDuration)',
  'variance    = spent - planned',
]) {
  assert.ok(calculation.includes(formulaToken), `calculation registry missing verified token: ${formulaToken}`);
}

for (const file of [
  'apps/mobile/components/renova/PrimaryButton.tsx',
  'apps/mobile/components/screens/OsObjectHubScreen.tsx',
  'apps/mobile/components/screens/OsRepairHubScreen.tsx',
  'apps/mobile/components/screens/OsBudgetHubScreen.tsx',
  'apps/mobile/components/screens/OsMaterialsScreen.tsx',
  'apps/mobile/components/screens/OsSelectionsScreen.tsx',
  'apps/mobile/components/screens/OsControlScreen.tsx',
  'apps/mobile/components/screens/control/CustomerControlView.tsx',
  'apps/mobile/components/screens/control/ContractorControlView.tsx',
  'apps/mobile/components/screens/control/TechnicalSupervisionControlView.tsx',
  'apps/mobile/components/renova/os/OsHubTabs.tsx',
]) {
  requireBlobReference(screenSources, file);
}

for (const screenToken of [
  'minimum touch target       = 44',
  'rooms | Комнаты',
  'works | Этапы',
  'picks      → Потребности',
  'proposed → Согласовать | Отклонить',
  'activeProject.access_mode == supervisor',
  'TechnicalSupervisionControlView',
  'local `Pressable` button styles instead of shared `PrimaryButton` variants',
]) {
  assert.ok(screens.includes(screenToken), `screen contract catalog missing verified token: ${screenToken}`);
}

console.log('Renova technical specification annex contract: OK');
