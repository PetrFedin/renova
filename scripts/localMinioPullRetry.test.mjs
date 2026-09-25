#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  CANONICAL_LOCAL_INFRA_SERVICES,
  isTransientRegistryError,
  pullLocalInfrastructureWithRetry,
} from './localMinioPull.mjs';

const silent = () => {};
const noSleep = async () => {};
const baseOptions = {
  projectName: 'renova-local',
  envFile: '/tmp/renova-local.env',
  composeFile: '/tmp/docker-compose.yml',
  delayMs: 0,
  sleep: noSleep,
  writeStdout: silent,
  writeStderr: silent,
};

assert.deepEqual(
  CANONICAL_LOCAL_INFRA_SERVICES,
  ['postgres', 'redis', 'minio'],
  'retry scope must remain limited to the canonical local infrastructure services',
);

for (const message of [
  'received unexpected HTTP status: 502 Bad Gateway',
  'received unexpected HTTP status: 503 Service Unavailable',
  'received unexpected HTTP status: 504 Gateway Time-out',
  'Client.Timeout exceeded while awaiting headers',
  'context deadline exceeded',
  'net/http: TLS handshake timeout',
  'dial tcp: i/o timeout',
  'connection reset by peer',
  'temporary failure in name resolution',
  'unexpected EOF',
]) {
  assert.equal(isTransientRegistryError(message), true, `expected transient classification: ${message}`);
}

for (const message of [
  'unauthorized: access to the requested resource is not authorized',
  'denied: requested access to the resource is denied',
  'manifest unknown: manifest unknown',
  'invalid reference format',
  'digest mismatch',
]) {
  assert.equal(isTransientRegistryError(message), false, `must fail closed without retry: ${message}`);
}

{
  const calls = [];
  const results = [
    { status: 1, stdout: 'minio Pulled\n', stderr: 'redis Error received unexpected HTTP status: 502 Bad Gateway\n' },
    { status: 0, stdout: 'postgres Pulled\nredis Pulled\nminio Pulled\n', stderr: '' },
  ];
  const result = await pullLocalInfrastructureWithRetry({
    ...baseOptions,
    maxAttempts: 3,
    runner: (args) => {
      calls.push([...args]);
      return results[calls.length - 1];
    },
  });
  assert.equal(result.attempts, 2, 'one transient registry failure must be retried once');
  assert.deepEqual(result.services, ['postgres', 'redis', 'minio']);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1], 'retry must use exactly the same Docker Compose command');
  assert.deepEqual(
    calls[0].slice(-4),
    ['pull', 'postgres', 'redis', 'minio'],
    'retry may pull only the canonical local infrastructure services',
  );
}

{
  let calls = 0;
  await assert.rejects(
    pullLocalInfrastructureWithRetry({
      ...baseOptions,
      maxAttempts: 3,
      runner: () => {
        calls += 1;
        return { status: 1, stdout: '', stderr: 'received unexpected HTTP status: 504 Gateway Time-out\n' };
      },
    }),
    (error) => {
      assert.equal(error.transient, true);
      assert.equal(error.attempts, 3);
      assert.match(error.message, /exhausted 3 attempts/);
      return true;
    },
  );
  assert.equal(calls, 3, 'transient failure must stop after the bounded retry budget');
}

{
  let calls = 0;
  await assert.rejects(
    pullLocalInfrastructureWithRetry({
      ...baseOptions,
      maxAttempts: 3,
      runner: () => {
        calls += 1;
        return { status: 1, stdout: '', stderr: 'manifest unknown: manifest unknown\n' };
      },
    }),
    (error) => {
      assert.equal(error.transient, false);
      assert.equal(error.attempts, 1);
      assert.match(error.message, /non-transient error/);
      return true;
    },
  );
  assert.equal(calls, 1, 'invalid/missing image truth must fail immediately without retry');
}

console.log('bounded canonical infrastructure pull retry contract: OK');
