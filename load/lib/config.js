export const LAUNCH_THRESHOLDS = {
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<1000", "p(99)<2500"],
  checks: ["rate>0.99"],
  renova_journey_failed: ["rate<0.01"],
};

function requiredEnv(name) {
  const value = (__ENV[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePositiveInt(name, fallback, min, max) {
  const raw = (__ENV[name] || "").trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseTokenPool() {
  const raw = requiredEnv("RENOVA_LOAD_TOKEN_POOL");
  let fixtures;
  try {
    fixtures = JSON.parse(raw);
  } catch (_error) {
    throw new Error("RENOVA_LOAD_TOKEN_POOL must be valid JSON");
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error("RENOVA_LOAD_TOKEN_POOL must be a non-empty JSON array");
  }
  return fixtures.map((fixture, index) => {
    if (!fixture || typeof fixture !== "object") {
      throw new Error(`load fixture ${index} must be an object`);
    }
    const token = String(fixture.token || "").trim();
    if (!token) {
      throw new Error(`load fixture ${index} is missing token`);
    }
    return {
      token,
      project_id: String(fixture.project_id || "").trim() || null,
      chat_thread_id: String(fixture.chat_thread_id || "").trim() || null,
    };
  });
}

export function loadConfig() {
  const baseUrl = requiredEnv("API_BASE_URL").replace(/\/+$/, "");
  const allowInsecureLocal = (__ENV.ALLOW_INSECURE_LOCAL || "").trim() === "true";
  if (!baseUrl.startsWith("https://") && !allowInsecureLocal) {
    throw new Error("API_BASE_URL must use https:// outside explicit local integrity tests");
  }

  const fixtures = parseTokenPool();
  const enableWrites = (__ENV.LOAD_ENABLE_WRITES || "").trim() === "true";
  if (enableWrites) {
    for (const [index, fixture] of fixtures.entries()) {
      if (!fixture.project_id || !fixture.chat_thread_id) {
        throw new Error(
          `write-enabled load fixture ${index} requires project_id and chat_thread_id`,
        );
      }
    }
  }

  const thinkMs = parsePositiveInt("LOAD_THINK_MS", 250, 0, 10000);
  const writeEvery = parsePositiveInt("LOAD_WRITE_EVERY", 20, 1, 10000);
  const maxWritesPerVu = parsePositiveInt("LOAD_MAX_WRITES_PER_VU", 5, 0, 1000);
  const runId = ((__ENV.LOAD_RUN_ID || "load").trim() || "load").replace(
    /[^a-zA-Z0-9_.-]/g,
    "-",
  );

  return {
    baseUrl,
    fixtures,
    enableWrites,
    thinkSeconds: thinkMs / 1000,
    writeEvery,
    maxWritesPerVu,
    runId: runId.slice(0, 80),
  };
}

export function fixtureForVu(config) {
  return config.fixtures[(__VU - 1) % config.fixtures.length];
}

export function bearerHeaders(token, correlationId, jsonBody = false) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Correlation-Id": correlationId,
  };
  if (jsonBody) headers["Content-Type"] = "application/json";
  return headers;
}
