import http from "k6/http"; import { check, sleep } from "k6";
export const options = { vus: 20, duration: "30s" };
export default function () {
  const API = "http://127.0.0.1:8100";
  const c = http.post(`${API}/api/v1/auth/demo`, JSON.stringify({ role: "customer" }), { headers: { "Content-Type": "application/json" } });
  const k = http.post(`${API}/api/v1/auth/demo`, JSON.stringify({ role: "contractor" }), { headers: { "Content-Type": "application/json" } });
  const cid = c.json("id"); const kid = k.json("id");
  const pid = http.get(`${API}/api/v1/projects`, { headers: { "X-User-Id": cid } }).json()[0].id;
  check(http.post(`${API}/api/v1/projects/${pid}/assign`, null, { headers: { "X-User-Id": kid } }), { a: (r) => r.status === 200 });
  const st = http.get(`${API}/api/v1/projects/${pid}`, { headers: { "X-User-Id": cid } }).json().stages[0];
  check(http.post(`${API}/api/v1/projects/${pid}/chats`, JSON.stringify({ title: "k6" }), { headers: { "X-User-Id": cid, "Content-Type": "application/json" } }), { ch: (r) => r.status === 200 });
  sleep(0.2);
}
