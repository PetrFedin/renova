import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const environment = read("backend/app/core/environment.py");
const environmentTests = read("backend/tests/test_environment_guards.py");
const ci = read(".github/workflows/ci.yml");
const staging = read(".github/workflows/staging-runtime-smoke.yml");

function syntheticWorkingKeys(source) {
  return [...source.matchAll(/^\s*SECRET_KEY:\s*(ci-staging-[^\s#]+)\s*$/gm)].map(
    (match) => match[1],
  );
}

test("staging and production require at least 256 bits of HS256 key material", () => {
  assert.match(environment, /^MIN_WORKING_SECRET_BYTES = 32$/m);
  assert.match(environment, /len\(value\.encode\("utf-8"\)\) < MIN_WORKING_SECRET_BYTES/);
  assert.match(environment, /_is_weak_working_secret\(secret_key or ""\)/);
  assert.match(environment, /MIN_WORKING_SECRET_BYTES\} байт UTF-8 для HS256/);
  assert.match(environmentTests, /MIN_WORKING_SECRET_BYTES - 1/);
  assert.match(environmentTests, /match="32 байт"/);
});

test("synthetic working-environment CI signing keys satisfy the same minimum", () => {
  const keys = [...syntheticWorkingKeys(ci), ...syntheticWorkingKeys(staging)];
  assert.ok(keys.length >= 2, "expected explicit staging signing fixtures in CI and staging smoke");
  for (const key of keys) {
    assert.ok(
      Buffer.byteLength(key, "utf8") >= 32,
      `synthetic working-environment SECRET_KEY is too short: ${key}`,
    );
  }
  assert.equal(ci.includes("ci-staging-secret-key-32chars!!"), false);
  assert.equal(staging.includes("ci-staging-secret-key-32chars!!"), false);
});
