import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "renova_offline_queue";

export type OfflineJob = { path: string; method: string; body: string; userId: string; ts: number; id: string };

export async function getQueue(): Promise<OfflineJob[]> {
  return JSON.parse((await AsyncStorage.getItem(KEY)) || "[]");
}

export async function queueStats() {
  const q = await getQueue();
  return { pending: q.length };
}

export async function enqueue(job: Omit<OfflineJob, "ts" | "id">) {
  const q = await getQueue();
  q.push({ ...job, ts: Date.now(), id: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  return q.length;
}

export async function removeJob(id: string) {
  const q = (await getQueue()).filter((j) => j.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  return q.length;
}

export async function flush(apiBase: string) {
  const q = await getQueue();
  if (!q.length) return { synced: 0, conflicts: 0, pending: 0 };
  const sorted = [...q].sort((a, b) => a.ts - b.ts);
  const left: OfflineJob[] = [];
  let synced = 0, conflicts = 0;
  for (const j of sorted) {
    try {
      const r = await fetch(`${apiBase}${j.path}`, {
        method: j.method,
        headers: { "Content-Type": "application/json", "X-User-Id": j.userId, "X-Offline-Id": j.id },
        body: j.body,
      });
      if (r.status === 409) { conflicts++; left.push(j); continue; }
      if (!r.ok) left.push(j); else synced++;
    } catch { left.push(j); }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(left));
  return { synced, conflicts, pending: left.length };
}
