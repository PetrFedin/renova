import http from "k6/http"; import { check } from "k6";
export const options = { vus: 5, duration: "10s" };
export default function () {
  const r = http.post("http://127.0.0.1:8100/api/v1/auth/demo", JSON.stringify({ role: "customer" }), { headers: { "Content-Type": "application/json" } });
  check(r, { ok: (x) => x.status === 200 });
}
