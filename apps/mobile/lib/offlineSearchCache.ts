import AsyncStorage from '@react-native-async-storage/async-storage';
import { ProjectDetail } from '@/lib/api';
const KEY = 'renova_search_cache';
export async function cacheProjectSearch(p: ProjectDetail) {
  await AsyncStorage.setItem(KEY, JSON.stringify({
    id: p.id,
    stages: p.stages.map(s => ({ id: s.id, name: s.name, status: s.status })),
    rooms: (p.rooms || []).map(r => ({ id: r.id, name: r.name, floor_sq_m: r.floor_sq_m })),
  }));
}
export async function getCachedSearch(): Promise<{ stages: {id:string;name:string;status:string}[]; rooms: {id:string;name:string;floor_sq_m:number}[] } | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}
