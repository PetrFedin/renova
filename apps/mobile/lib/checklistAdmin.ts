import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'renova_checklist_templates';
export async function getChecklistTemplates(): Promise<Record<string, string[]>> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : { default: ['Качество OK', 'Фото приложены'] };
}
export async function saveTemplate(name: string, items: string[]) {
  const t = await getChecklistTemplates();
  t[name.toLowerCase()] = items;
  await AsyncStorage.setItem(KEY, JSON.stringify(t));
}
