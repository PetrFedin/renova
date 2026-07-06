import http from "k6/http"; import { check, sleep } from "k6";
export const options = { stages: [{ duration: "1m", target: 100 }, { duration: "2m", target: 100 }, { duration: "30s", target: 0 }] };
export default function () {
  const API = "http://127.0.0.1:8100";
  const c = http.post(`${API}/api/v1/auth/demo`, JSON.stringify({ role: "customer" }), { headers: { "Content-Type": "application/json" } });
  const cid = c.json("id");
  const ps = http.get(`${API}/api/v1/projects`, { headers: { "X-User-Id": cid } });
  check(ps, { ok: (r) => r.status === 200 });
  const pid = ps.json()[0].id;
  check(http.get(`${API}/api/v1/projects/${pid}/rooms`, { headers: { "X-User-Id": cid } }), { rooms: (r) => r.status === 200 });
  check(http.get(`${API}/api/v1/projects/${pid}/calendar`, { headers: { "X-User-Id": cid } }), { cal: (r) => r.status === 200 });
  sleep(0.3);
}
