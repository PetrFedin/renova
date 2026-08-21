import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

import { LAUNCH_THRESHOLDS } from "./lib/config.js";

const journeyFailed = new Rate("renova_journey_failed");
const webhookFailed = new Rate("renova_webhook_failed");

function requiredEnv(name) {
  const value = (__ENV[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = requiredEnv("API_BASE_URL").replace(/\/+$/, "");
if (!baseUrl.startsWith("https://")) {
  throw new Error("webhook burst is external-staging only and requires https://");
}
const webhookSecret = requiredEnv("RENOVA_YOOKASSA_WEBHOOK_SECRET");
const runId = ((__ENV.LOAD_RUN_ID || "load-webhook").trim() || "load-webhook").replace(
  /[^a-zA-Z0-9_.-]/g,
  "-",
).slice(0, 80);

export const options = {
  scenarios: {
    webhook_burst: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 25,
      maxVUs: 100,
      stages: [
        { duration: "15s", target: 25 },
        { duration: "30s", target: 50 },
        { duration: "15s", target: 5 },
      ],
    },
  },
  thresholds: {
    ...LAUNCH_THRESHOLDS,
    renova_webhook_failed: ["rate<0.01"],
    "http_req_duration{name:POST /api/v1/subscription/webhook [burst]}": [
      "p(95)<1000",
      "p(99)<2500",
    ],
  },
};

export default function () {
  // Safe staging-only envelope: the provider delivery ledger is exercised, but
  // business payment state is not mutated because the event kind is unsupported.
  // IDs are bounded per run so repeated load tests do not create an unbounded
  // number of delivery rows; later passes through a completed slot test durable
  // duplicate handling as well as fresh claims.
  const eventSlot = ((__VU - 1) % 100) * 50 + (__ITER % 50);
  const eventId = `load-${runId}-${eventSlot}`;
  const body = JSON.stringify({
    event: "load.capacity_probe",
    object: {
      id: eventId,
      status: "ignored",
      metadata: { kind: "load_capacity_probe" },
    },
  });
  const response = http.post(`${baseUrl}/api/v1/subscription/webhook`, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": webhookSecret,
      "X-Correlation-ID": `${runId}-${__VU}-${__ITER}`,
    },
    tags: { name: "POST /api/v1/subscription/webhook [burst]" },
    timeout: "20s",
  });
  const ok = check(response, {
    "webhook burst accepted": (item) => item.status === 200,
    "webhook burst no payment mutation": (item) => {
      try {
        const payload = item.json();
        return payload.accepted === true && payload.business_applied === false;
      } catch (_error) {
        return false;
      }
    },
  });
  webhookFailed.add(ok ? 0 : 1);
  journeyFailed.add(ok ? 0 : 1);
  sleep(0.01);
}
