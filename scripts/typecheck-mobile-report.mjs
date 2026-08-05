#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const IGNORED_CODES = new Set(['2786', '2607']);
const DIAGNOSTIC_PATTERN = /error TS(\d+):/g;

export function analyzeTypecheckOutput(output) {
  const text = String(output ?? '');
  const diagnostics = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    for (const match of line.matchAll(DIAGNOSTIC_PATTERN)) {
      diagnostics.push({
        code: match[1],
        line,
        ignored: IGNORED_CODES.has(match[1]),
      });
    }
  }

  const ignored2786 = diagnostics.filter((item) => item.code === '2786').length;
  const ignored2607 = diagnostics.filter((item) => item.code === '2607').length;
  const realDiagnostics = diagnostics.filter((item) => !item.ignored);

  return {
    total: diagnostics.length,
    ignored2786,
    ignored2607,
    real: realDiagnostics.length,
    realLines: [...new Set(realDiagnostics.map((item) => item.line))],
  };
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function evaluateTypecheckRun({ output, tscExitCode, baseline, strict = false }) {
  const exitCode = nonNegativeInteger(tscExitCode, 'tsc exit code');
  const allowedReal = nonNegativeInteger(baseline, 'baseline');
  const analysis = analyzeTypecheckOutput(output);
  const errors = [];

  if (exitCode === 0 && analysis.total > 0) {
    errors.push('tsc exited successfully while diagnostics were present');
  }
  if (exitCode !== 0 && analysis.total === 0) {
    errors.push(`tsc failed with exit code ${exitCode} but produced no TypeScript diagnostics`);
  }
  if (analysis.real > allowedReal) {
    errors.push(`real errors ${analysis.real} exceed baseline ${allowedReal}`);
  }
  if (strict && analysis.real > 0) {
    errors.push(`strict mode requires zero real errors, found ${analysis.real}`);
  }

  return {
    ok: errors.length === 0,
    exitCode,
    baseline: allowedReal,
    strict: Boolean(strict),
    ...analysis,
    errors,
  };
}

function parseArgs(args) {
  const values = new Map();
  let strict = false;
  for (const arg of args) {
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`unsupported argument: ${arg}`);
    values.set(match[1], match[2]);
  }

  const input = values.get('input');
  if (!input) throw new Error('--input=<path> is required');
  if (!existsSync(input)) throw new Error(`typecheck output file does not exist: ${input}`);

  return {
    input,
    tscExitCode: values.get('tsc-exit') ?? '0',
    baseline: values.get('baseline') ?? '0',
    strict,
  };
}

export function runTypecheckReport(args) {
  const options = parseArgs(args);
  const output = readFileSync(options.input, 'utf8');
  return evaluateTypecheckRun({
    output,
    tscExitCode: options.tscExitCode,
    baseline: options.baseline,
    strict: options.strict,
  });
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const result = runTypecheckReport(process.argv.slice(2));
    console.log(
      `typecheck-mobile: TS2786=${result.ignored2786} TS2607=${result.ignored2607} real=${result.real} baseline=${result.baseline} tsc_exit=${result.exitCode}`,
    );

    if (result.realLines.length > 0) {
      console.log('--- real errors (first 20) ---');
      for (const line of result.realLines.slice(0, 20)) console.log(line);
    }

    if (!result.ok) {
      for (const error of result.errors) console.error(`FAIL: ${error}`);
      process.exit(1);
    }

    if (result.real > 0) {
      console.log(`WARN: ${result.real} real errors are within baseline; use --strict for zero tolerance`);
    } else {
      console.log('PASS: no real TypeScript errors (known JSX noise gated)');
    }
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
