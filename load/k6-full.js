import http from "k6/http"; import { check, sleep } from "k6";
export const options = { vus: 3, duration: "15s" };
export default function () {
  const API = "http://127.0.0.1:8100";
  const c = http.post(`${API}/api/v1/auth/demo`, JSON.stringify({ role: "customer" }), { headers: { "Content-Type": "application/json" } });
  const k = http.post(`${API}/api/v1/auth/demo`, JSON.stringify({ role: "contractor" }), { headers: { "Content-Type": "application/json" } });
  const cid = c.json("id"); const kid = k.json("id");
  const ps = http.get(`${API}/api/v1/projects`, { headers: { "X-User-Id": cid } });
  const pid = ps.json()[0].id;
  check(http.post(`${API}/api/v1/projects/${pid}/assign`, null, { headers: { "X-User-Id": kid } }), { a: (r) => r.status === 200 });
  check(http.get(`${API}/api/v1/projects/${pid}/rooms`, { headers: { "X-User-Id": cid } }), { r: (r) => r.status === 200 });
  check(http.get(`${API}/api/v1/admin/stats`, { headers: { "X-User-Id": kid } }), { s: (r) => r.status === 200 });
  sleep(0.5);
}
