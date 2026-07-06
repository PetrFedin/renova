import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatThread } from '@/lib/api';
const KEY = 'renova_chat_search';
export async function indexChats(threads: ChatThread[]) {
  const idx = threads.map(t => ({ id: t.id, title: t.title, text: t.last_message?.text || '' }));
  await AsyncStorage.setItem(KEY, JSON.stringify(idx));
}
export async function searchChats(q: string): Promise<{ id: string; title: string; text: string }[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw || !q.trim()) return [];
  const s = q.toLowerCase();
  return JSON.parse(raw).filter((x: any) => x.title.toLowerCase().includes(s) || x.text.toLowerCase().includes(s));
}
