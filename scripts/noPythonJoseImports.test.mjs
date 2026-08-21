import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import "./jwtSecretPolicyIntegrity.test.mjs";

const roots = ["backend/app", "backend/tests"];
const joseImport = /^\s*(?:from\s+jose(?:\.|\s)|import\s+jose(?:\.|\s|,|$))/m;

function pythonFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...pythonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".py")) result.push(full);
  }
  return result;
}

test("python-jose imports are absent across backend source and tests", () => {
  const violations = [];
  for (const root of roots) {
    for (const file of pythonFiles(root)) {
      const source = fs.readFileSync(file, "utf8");
      if (joseImport.test(source)) violations.push(file);
    }
  }

  const pyproject = fs.readFileSync("backend/pyproject.toml", "utf8").toLowerCase();
  const lock = fs.readFileSync("backend/poetry.lock", "utf8").toLowerCase();
  assert.equal(pyproject.includes("python-jose"), false, "python-jose must not return to pyproject");
  assert.equal(lock.includes('name = "python-jose"'), false, "python-jose must not return to lock");
  assert.deepEqual(violations, [], `python-jose imports remain: ${violations.join(", ")}`);
});
