#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validatePlaywrightStats(stats, options = {}) {
  const minExpected = Number(options.minExpected ?? 1);
  const maxSkipped = Number(options.maxSkipped ?? 0);
  const expected = Number(stats?.expected ?? 0);
  const skipped = Number(stats?.skipped ?? 0);
  const unexpected = Number(stats?.unexpected ?? 0);
  const flaky = Number(stats?.flaky ?? 0);
  const errors = [];

  if (!Number.isFinite(expected) || expected < minExpected) {
    errors.push(`expected tests ${expected} is below required minimum ${minExpected}`);
  }
  if (!Number.isFinite(skipped) || skipped > maxSkipped) {
    errors.push(`skipped tests ${skipped} exceeds allowed maximum ${maxSkipped}`);
  }
  if (!Number.isFinite(unexpected) || unexpected > 0) {
    errors.push(`unexpected tests ${unexpected} must be zero`);
  }
  if (!Number.isFinite(flaky) || flaky > 0) {
    errors.push(`flaky tests ${flaky} must be zero`);
  }

  return {
    ok: errors.length === 0,
    expected,
    skipped,
    unexpected,
    flaky,
    errors,
  };
}

function parseIntegerFlag(args, name, fallback) {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number(raw.slice(prefix.length));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function assertPlaywrightReport(reportPath, args = []) {
  if (!reportPath) throw new Error('playwright report path is required');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const result = validatePlaywrightStats(report.stats, {
    minExpected: parseIntegerFlag(args, 'min-expected', 1),
    maxSkipped: parseIntegerFlag(args, 'max-skipped', 0),
  });
  if (!result.ok) {
    throw new Error(`Playwright report rejected: ${result.errors.join('; ')}`);
  }
  return result;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const [reportPath, ...args] = process.argv.slice(2);
    const result = assertPlaywrightReport(reportPath, args);
    console.log(
      `Playwright report accepted: expected=${result.expected} skipped=${result.skipped} unexpected=${result.unexpected} flaky=${result.flaky}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
