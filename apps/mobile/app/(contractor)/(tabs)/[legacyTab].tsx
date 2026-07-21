import { LegacyTabRedirect } from '@/components/routing/LegacyTabRedirect';
import { useLocalSearchParams } from 'expo-router';

/** P3-W37: catch-all legacy tabs для contractor */
export default function ContractorLegacyTabCatchAll() {
  const { legacyTab } = useLocalSearchParams<{ legacyTab: string }>();
  const seg = Array.isArray(legacyTab) ? legacyTab[0] : legacyTab;
  if (!seg) return null;
  return <LegacyTabRedirect path={`/(contractor)/(tabs)/${seg}`} />;
}
