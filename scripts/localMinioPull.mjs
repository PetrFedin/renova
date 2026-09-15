#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TRANSIENT_REGISTRY_PATTERNS = [
  /\b502\b[^\n]*(?:bad gateway|gateway)/i,
  /\b503\b[^\n]*(?:service unavailable|unavailable)/i,
  /\b504\b[^\n]*(?:gateway time-?out|gateway timeout)/i,
  /unexpected http status:\s*(?:502|503|504)\b/i,
  /client\.timeout exceeded while awaiting headers/i,
  /context deadline exceeded/i,
  /tls handshake timeout/i,
  /\bi\/o timeout\b/i,
  /connection reset by peer/i,
  /temporary failure in name resolution/i,
  /net\/http: request canceled while waiting for connection/i,
  /unexpected eof/i,
];

export const CANONICAL_LOCAL_INFRA_SERVICES = Object.freeze([
  'postgres',
  'redis',
  'minio',
]);

export function isTransientRegistryError(output) {
  const text = String(output ?? '');
  return TRANSIENT_REGISTRY_PATTERNS.some((pattern) => pattern.test(text));
}

function boundedInteger(raw, fallback, { min, max, name }) {
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw))) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function defaultRunner(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) {
    return {
      status: typeof result.status === 'number' ? result.status : 127,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${result.error.message}\n`,
    };
  }
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const defaultSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function pullLocalInfrastructureWithRetry({
  projectName,
  envFile,
  composeFile,
  maxAttempts = boundedInteger(process.env.RENOVA_INFRA_PULL_MAX_ATTEMPTS, 3, {
    min: 1,
    max: 5,
    name: 'RENOVA_INFRA_PULL_MAX_ATTEMPTS',
  }),
  delayMs = boundedInteger(process.env.RENOVA_INFRA_PULL_RETRY_DELAY_MS, 2000, {
    min: 0,
    max: 30000,
    name: 'RENOVA_INFRA_PULL_RETRY_DELAY_MS',
  }),
  runner = defaultRunner,
  sleep = defaultSleep,
  writeStdout = (text) => process.stdout.write(text),
  writeStderr = (text) => process.stderr.write(text),
}) {
  for (const [name, value] of Object.entries({ projectName, envFile, composeFile })) {
    if (!value) throw new Error(`${name} is required`);
  }

  const args = [
    'compose',
    '--project-name',
    projectName,
    '--env-file',
    envFile,
    '-f',
    composeFile,
    'pull',
    ...CANONICAL_LOCAL_INFRA_SERVICES,
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runner(args);
    if (result.stdout) writeStdout(String(result.stdout));
    if (result.stderr) writeStderr(String(result.stderr));

    if (result.status === 0) {
      writeStdout(
        `[renova-dev] canonical infrastructure pull succeeded on attempt ${attempt}/${maxAttempts}\n`,
      );
      return { attempts: attempt, services: [...CANONICAL_LOCAL_INFRA_SERVICES] };
    }

    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const transient = isTransientRegistryError(combined);
    const reason = transient ? 'transient registry transport failure' : 'non-transient pull failure';
    writeStderr(
      `[renova-dev] infrastructure pull attempt ${attempt}/${maxAttempts} failed: ${reason}\n`,
    );

    if (!transient || attempt === maxAttempts) {
      const error = new Error(
        transient
          ? `canonical infrastructure pull exhausted ${maxAttempts} attempts without changing Compose image references`
          : 'canonical infrastructure pull failed with a non-transient error; no retry or fallback is permitted',
      );
      error.exitCode = result.status || 2;
      error.attempts = attempt;
      error.transient = transient;
      throw error;
    }

    writeStderr(
      `[renova-dev] retrying the same canonical Compose image references after ${delayMs}ms; alternate registry/tag/digest fallback is forbidden\n`,
    );
    await sleep(delayMs);
  }

  throw new Error('unreachable infrastructure pull retry state');
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`missing value for ${key ?? '<argument>'}`);
    if (key === '--project-name') values.projectName = value;
    else if (key === '--env-file') values.envFile = value;
    else if (key === '--compose-file') values.composeFile = value;
    else throw new Error(`unsupported argument: ${key}`);
  }
  return values;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  try {
    const options = parseCli(process.argv.slice(2));
    await pullLocalInfrastructureWithRetry(options);
  } catch (error) {
    process.stderr.write(`[renova-dev] ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 2;
  }
}
