import AsyncStorage from '@react-native-async-storage/async-storage';
export async function getCustomChecks(stageId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(`renova_checks_${stageId}`);
  return raw ? JSON.parse(raw) : [];
}
export async function addCustomCheck(stageId: string, text: string) {
  const list = await getCustomChecks(stageId);
  if (!text.trim() || list.includes(text.trim())) return list;
  const next = [...list, text.trim()];
  await AsyncStorage.setItem(`renova_checks_${stageId}`, JSON.stringify(next));
  return next;
}
