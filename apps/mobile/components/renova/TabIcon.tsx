/** Монохромные outline-иконки — цвет задаёт tab bar (active/inactive) */
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { Platform } from 'react-native';

const ION: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  rooms: 'grid-outline',
  estimate: 'list-outline',
  stages: 'checkmark-circle-outline',
  calendar: 'calendar-outline',
  chat: 'chatbubble-outline',
  finance: 'wallet-outline',
  guide: 'book-outline',
  profile: 'person-outline',
  objects: 'business-outline',
  more: 'ellipsis-horizontal-outline',
  works: 'hammer-outline',
  budget: 'wallet-outline',
  materials: 'cube-outline',
  control: 'shield-checkmark-outline',
};

const SF = {
  home: 'house', rooms: 'square.split.2x2', estimate: 'list.bullet.rectangle',
  stages: 'checkmark.circle', calendar: 'calendar', chat: 'bubble.left.and.bubble.right',
  finance: 'rublesign.circle', guide: 'book', profile: 'person', objects: 'building.2',
} as const;

export type TabIconKey = keyof typeof ION;

export function TabIcon({ name, color, size = 20 }: { name: TabIconKey; color: string; size?: number }) {
  if (Platform.OS === 'web') {
    return <Ionicons name={ION[name]} size={size} color={color} />;
  }
  const sf = SF[name as keyof typeof SF];
  return <SymbolView name={{ ios: sf, android: sf, web: sf }} tintColor={color} size={size} />;
}
