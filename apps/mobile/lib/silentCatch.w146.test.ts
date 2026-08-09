/**
 * W146: critical async failures must not silently become fake success/empty state.
 *
 * Existing debt is explicit and count-based. CI fails on:
 * - any new silent async fallback;
 * - any increase in an existing file/kind;
 * - a stale baseline after debt is fixed (forcing the baseline to shrink).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const root = join(__dirname, '..');
const skip = new Set([
  // Error reporter cannot recursively report a missing optional reporter SDK.
  'lib/reportError.ts',
  'lib/failClosed.w144.test.ts',
  'lib/oauthScaffold.w145.test.ts',
  'lib/silentCatch.w146.test.ts',
]);

type DebtKind = 'async' | 'promise';
const debtKey = (file: string, kind: DebtKind) => `${file}|${kind}`;

/**
 * Snapshot from the first structural audit after fixing session/bootstrap,
 * integration-health, and portfolio truth gaps. Do not add entries casually:
 * product fixes should reduce these counts; intentional best-effort paths should
 * become observable or carry a narrow `silent-catch-ok:` comment.
 */
const KNOWN_DEBT: Record<string, number> = {
  [debtKey('components/renova/FloorPlanPanel.tsx', 'async')]: 3,
  [debtKey('components/renova/JobLeadsBoard.tsx', 'async')]: 1,
  [debtKey('components/renova/PaymentDetailSheet.tsx', 'async')]: 1,
  [debtKey('components/renova/ProjectEmptyState.tsx', 'async')]: 1,
  [debtKey('components/renova/chat/ChatThreadView.tsx', 'async')]: 2,
  [debtKey('components/screens/OsHomeScreen.tsx', 'async')]: 1,
  [debtKey('components/screens/OsRoomsScreen.tsx', 'async')]: 2,
  [debtKey('lib/chatPrefs.ts', 'async')]: 1,
  [debtKey('lib/context/RenovaContext.tsx', 'promise')]: 1,
  [debtKey('lib/context/RenovaContext.tsx', 'async')]: 4,
  [debtKey('lib/customerBudgetPrefs.ts', 'async')]: 1,
  [debtKey('lib/domain/buildInboxItems.ts', 'async')]: 19,
  [debtKey('lib/homeWidgetPrefs.ts', 'async')]: 1,
  [debtKey('lib/hooks/useProjectBuckets.ts', 'async')]: 1,
  [debtKey('lib/inboxSyncStore.ts', 'async')]: 3,
  [debtKey('lib/offlineQueue.ts', 'async')]: 1,
  [debtKey('lib/offlineQueue.ts', 'promise')]: 1,
  [debtKey('lib/projectDataBus.ts', 'async')]: 1,
  [debtKey('lib/secureTokenStore.ts', 'async')]: 1,
  [debtKey('lib/voiceRecord.ts', 'async')]: 1,
  [debtKey('lib/whisperStub.ts', 'async')]: 1,
  [debtKey('lib/wsAuthQuery.ts', 'async')]: 1,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

function isExplicitlyAllowed(node: ts.Node, source: ts.SourceFile): boolean {
  return source.text.slice(node.getFullStart(), node.getEnd()).includes('silent-catch-ok:');
}

function isFallbackExpression(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(node) && node.text === 'undefined') return true;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
  if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isFallbackExpression(node.expression);
  return false;
}

function containsAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isAwaitExpression(current)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function hasObservableFailurePath(node: ts.Node): boolean {
  let observable = false;
  const visit = (current: ts.Node): void => {
    if (observable) return;
    if (ts.isThrowStatement(current)) {
      observable = true;
      return;
    }
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText();
      if (
        callee === 'reportError' ||
        callee === 'reportCatch' ||
        callee === 'console.error' ||
        callee === 'console.warn'
      ) {
        observable = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return observable;
}

function catchClauseIsSilent(node: ts.CatchClause): boolean {
  // This gate targets async integrity. Synchronous parse/format fallbacks are
  // intentionally outside W146 and should be covered by their domain tests.
  const tryStatement = node.parent;
  if (!ts.isTryStatement(tryStatement) || !containsAwait(tryStatement.tryBlock)) return false;

  if (node.block.statements.length === 0) return true;
  if (hasObservableFailurePath(node.block)) return false;

  const returns = node.block.statements.filter(ts.isReturnStatement);
  return returns.length > 0 && returns.length === node.block.statements.length && returns.every((statement) => isFallbackExpression(statement.expression));
}

function promiseCatchIsSilent(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'catch') return false;
  const handler = node.arguments[0];
  if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) return false;
  if (hasObservableFailurePath(handler.body)) return false;

  if (ts.isBlock(handler.body)) {
    if (handler.body.statements.length === 0) return true;
    const returns = handler.body.statements.filter(ts.isReturnStatement);
    return returns.length > 0 && returns.length === handler.body.statements.length && returns.every((statement) => isFallbackExpression(statement.expression));
  }

  return isFallbackExpression(handler.body);
}

const actual = new Map<string, { count: number; lines: number[] }>();
function record(key: string, line: number): void {
  const current = actual.get(key) ?? { count: 0, lines: [] };
  current.count += 1;
  current.lines.push(line);
  actual.set(key, current);
}

for (const file of walk(root)) {
  const rel = file.slice(root.length + 1).replace(/\\/g, '/');
  if (skip.has(rel)) continue;

  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node): void => {
    if (!isExplicitlyAllowed(node, source)) {
      if (ts.isCatchClause(node) && catchClauseIsSilent(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        record(debtKey(rel, 'async'), line + 1);
      } else if (ts.isCallExpression(node) && promiseCatchIsSilent(node)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        record(debtKey(rel, 'promise'), line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const failures: string[] = [];
const allKeys = new Set([...Object.keys(KNOWN_DEBT), ...actual.keys()]);
for (const key of [...allKeys].sort()) {
  const expected = KNOWN_DEBT[key] ?? 0;
  const found = actual.get(key)?.count ?? 0;
  const lines = actual.get(key)?.lines.join(',') ?? '-';
  if (found > expected) {
    failures.push(`${key}: regression ${expected} -> ${found} (lines ${lines})`);
  } else if (found < expected) {
    failures.push(`${key}: baseline stale ${expected} -> ${found}; shrink KNOWN_DEBT (lines ${lines})`);
  }
}

if (failures.length) {
  throw new Error(
    'silent async integrity baseline changed:\n' +
      failures.join('\n') +
      '\nFix/report/rethrow new failures; when debt is removed, shrink KNOWN_DEBT in the same change.',
  );
}

const debtTotal = [...actual.values()].reduce((sum, item) => sum + item.count, 0);
console.log(`silentCatch.w146.test OK known_debt=${debtTotal}`);
