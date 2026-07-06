/** Настройки экрана «Сообщения» — фильтр объектов */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatProjectFilter } from '@/lib/chatProjectFilter';

const KEY = 'renova_chat_project_filter_v1';

export async function getChatProjectFilter(): Promise<ChatProjectFilter | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChatProjectFilter;
  } catch {
    return null;
  }
}

export async function setChatProjectFilter(value: ChatProjectFilter): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(value));
}
