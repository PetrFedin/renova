/** W146: critical async failures must not silently become fake success/empty state. */
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

const offenders: string[] = [];
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

  const record = (node: ts.Node, kind: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    offenders.push(`${rel}:${line + 1} ${kind}`);
  };

  const visit = (node: ts.Node): void => {
    if (!isExplicitlyAllowed(node, source)) {
      if (ts.isCatchClause(node) && catchClauseIsSilent(node)) {
        record(node, 'silent catch block');
      } else if (ts.isCallExpression(node) && promiseCatchIsSilent(node)) {
        record(node, 'silent promise fallback');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (offenders.length) {
  throw new Error(
    'silent failure/fallback remains; report, rethrow, or document an intentional best-effort catch with `silent-catch-ok:`:\n' +
      offenders.join('\n'),
  );
}

console.log('silentCatch.w146.test OK');
