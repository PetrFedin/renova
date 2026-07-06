import http from "k6/http"; import { check, sleep } from "k6";
export const options = { stages: [{ duration: "2m", target: 200 }, { duration: "5m", target: 200 }, { duration: "1m", target: 0 }] };
export default function () {
  check(http.get("http://127.0.0.1:8100/health"), { ok: (r) => r.status === 200 });
  sleep(0.5);
}
