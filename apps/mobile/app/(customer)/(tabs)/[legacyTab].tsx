import { LegacyTabRedirect } from '@/components/routing/LegacyTabRedirect';
import { useLocalSearchParams } from 'expo-router';

/**
 * P3-W37: один catch-all вместо N LegacyTabRedirect-файлов.
 * Статические экраны (index/object/repair/budget/…) имеют приоритет над этим маршрутом.
 */
export default function CustomerLegacyTabCatchAll() {
  const { legacyTab } = useLocalSearchParams<{ legacyTab: string }>();
  const seg = Array.isArray(legacyTab) ? legacyTab[0] : legacyTab;
  if (!seg) return null;
  return <LegacyTabRedirect path={`/(customer)/(tabs)/${seg}`} />;
}
