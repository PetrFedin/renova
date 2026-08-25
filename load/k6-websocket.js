import http from "k6/http";
import ws from "k6/ws";
import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

import { bearerHeaders, fixtureForVu, loadConfig, LAUNCH_THRESHOLDS } from "./lib/config.js";

const journeyFailed = new Rate("renova_journey_failed");
const wsConnectFailed = new Rate("renova_ws_connect_failed");
const wsDeliveryFailed = new Rate("renova_ws_delivery_failed");
const wsDeliveryMs = new Trend("renova_ws_delivery_ms", true);

export const options = {
  vus: 20,
  duration: "1m",
  thresholds: {
    ...LAUNCH_THRESHOLDS,
    renova_ws_connect_failed: ["rate<0.01"],
    renova_ws_delivery_failed: ["rate<0.01"],
    renova_ws_delivery_ms: ["p(95)<1000", "p(99)<2500"],
  },
};

function requestParams(headers, name) {
  return {
    headers,
    tags: { name },
    timeout: "20s",
  };
}

export default function () {
  const config = loadConfig();
  const fixture = fixtureForVu(config);
  if (!config.enableWrites) {
    throw new Error("websocket scenario requires LOAD_ENABLE_WRITES=true and dedicated fixtures");
  }
  if (!fixture.project_id || !fixture.chat_thread_id) {
    throw new Error("websocket scenario requires project_id and chat_thread_id for every fixture");
  }

  const correlationId = `${config.runId}-ws-vu${__VU}-iter${__ITER}`;
  const ticketResponse = http.post(
    `${config.baseUrl}/api/v1/auth/ws-ticket`,
    null,
    requestParams(bearerHeaders(fixture.token, correlationId), "POST /api/v1/auth/ws-ticket"),
  );
  const ticketOk = check(ticketResponse, {
    "ws ticket status 200": (item) => item.status === 200,
  });
  if (!ticketOk) {
    journeyFailed.add(1);
    wsConnectFailed.add(1);
    wsDeliveryFailed.add(1);
    return;
  }

  let ticket;
  try {
    ticket = ticketResponse.json("ticket");
  } catch (_error) {
    ticket = null;
  }
  if (!ticket) {
    journeyFailed.add(1);
    wsConnectFailed.add(1);
    wsDeliveryFailed.add(1);
    return;
  }

  const wsBase = config.baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const marker = `load-ws ${config.runId} vu=${__VU} iter=${__ITER}`;
  let delivered = false;
  let postOk = false;
  let postStartedAt = 0;

  const response = ws.connect(
    `${wsBase}/ws/chats/${fixture.chat_thread_id}?ticket=${encodeURIComponent(ticket)}`,
    { tags: { name: "WS /ws/chats/{thread_id}" } },
    (socket) => {
      socket.on("message", (raw) => {
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch (_error) {
          return;
        }
        const text = payload && payload.message && payload.message.text;
        if (payload && payload.type === "message" && text === marker) {
          delivered = true;
          if (postStartedAt > 0) wsDeliveryMs.add(Date.now() - postStartedAt);
          socket.close();
        }
      });

      socket.on("open", () => {
        postStartedAt = Date.now();
        const body = JSON.stringify({
          client_request_id: `load-ws-${config.runId}-vu${__VU}-iter${__ITER}`,
          text: marker,
          message_type: "text",
        });
        const postResponse = http.post(
          `${config.baseUrl}/api/v1/projects/${fixture.project_id}/chats/${fixture.chat_thread_id}/messages`,
          body,
          requestParams(
            bearerHeaders(fixture.token, correlationId, true),
            "POST /api/v1/projects/{project_id}/chats/{thread_id}/messages [ws fanout]",
          ),
        );
        postOk = check(postResponse, {
          "ws fanout source message status 200": (item) => item.status === 200,
        });
        if (!postOk) socket.close();
      });

      socket.setTimeout(() => socket.close(), 5000);
    },
  );

  const connected = response && response.status === 101;
  check(response, {
    "websocket upgraded": (item) => item && item.status === 101,
  });
  wsConnectFailed.add(connected ? 0 : 1);
  wsDeliveryFailed.add(connected && postOk && delivered ? 0 : 1);
  journeyFailed.add(connected && postOk && delivered ? 0 : 1);
}
