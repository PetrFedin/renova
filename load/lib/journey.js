import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

import { bearerHeaders, fixtureForVu, loadConfig } from "./config.js";

const journeyFailed = new Rate("renova_journey_failed");

function responseJson(response) {
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
}

function requestParams(headers, name) {
  return {
    headers,
    tags: { name },
    timeout: "20s",
  };
}

function checkedGet(url, headers, name) {
  const response = http.get(url, requestParams(headers, name));
  const ok = check(response, {
    [`${name} status 200`]: (item) => item.status === 200,
  });
  if (!ok) journeyFailed.add(1);
  return { response, ok };
}

export function runUserJourney() {
  const config = loadConfig();
  const fixture = fixtureForVu(config);
  const correlationId = `${config.runId}-vu${__VU}-iter${__ITER}`;
  const headers = bearerHeaders(fixture.token, correlationId);

  const projectsResult = checkedGet(
    `${config.baseUrl}/api/v1/projects`,
    headers,
    "GET /api/v1/projects",
  );
  if (!projectsResult.ok) return;

  const projects = responseJson(projectsResult.response);
  const projectId = fixture.project_id || (Array.isArray(projects) && projects[0] && projects[0].id);
  if (!projectId) {
    check(null, { "load identity has project fixture": () => false });
    journeyFailed.add(1);
    return;
  }

  const detail = checkedGet(
    `${config.baseUrl}/api/v1/projects/${projectId}`,
    headers,
    "GET /api/v1/projects/{project_id}",
  );
  const dashboard = checkedGet(
    `${config.baseUrl}/api/v1/projects/${projectId}/dashboard`,
    headers,
    "GET /api/v1/projects/{project_id}/dashboard",
  );
  const chats = checkedGet(
    `${config.baseUrl}/api/v1/projects/${projectId}/chats`,
    headers,
    "GET /api/v1/projects/{project_id}/chats",
  );

  const readPathOk = detail.ok && dashboard.ok && chats.ok;
  if (!readPathOk) return;

  const writeSlot = Math.floor(__ITER / config.writeEvery);
  const shouldWrite =
    config.enableWrites &&
    config.maxWritesPerVu > 0 &&
    __ITER % config.writeEvery === 0 &&
    writeSlot < config.maxWritesPerVu;

  if (shouldWrite) {
    const body = JSON.stringify({
      text: `load-check ${config.runId} vu=${__VU} iter=${__ITER}`,
      message_type: "text",
    });
    const response = http.post(
      `${config.baseUrl}/api/v1/projects/${projectId}/chats/${fixture.chat_thread_id}/messages`,
      body,
      requestParams(
        bearerHeaders(fixture.token, correlationId, true),
        "POST /api/v1/projects/{project_id}/chats/{thread_id}/messages",
      ),
    );
    const ok = check(response, {
      "bounded chat write status 200": (item) => item.status === 200,
    });
    if (!ok) journeyFailed.add(1);
  }

  journeyFailed.add(0);
  if (config.thinkSeconds > 0) sleep(config.thinkSeconds);
}
