import AsyncStorage from '@react-native-async-storage/async-storage';
export type Reaction = '👍' | '❓';
export async function toggleReaction(commentId: string, r: Reaction) {
  const key = `renova_react_${commentId}`;
  const cur = await AsyncStorage.getItem(key);
  const next = cur === r ? null : r;
  if (next) await AsyncStorage.setItem(key, next); else await AsyncStorage.removeItem(key);
  return next;
}
export async function getReaction(commentId: string) {
  return (await AsyncStorage.getItem(`renova_react_${commentId}`)) as Reaction | null;
}
