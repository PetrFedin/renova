import http from "k6/http"; import { check } from "k6";
export const options = { stages: [{ duration: "30s", target: 50 }, { duration: "30s", target: 50 }, { duration: "10s", target: 0 }] };
export default function () {
  const r = http.get("http://127.0.0.1:8100/health");
  check(r, { ok: (x) => x.status === 200 });
}
