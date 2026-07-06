import { LegacyTabRedirect } from '@/components/routing/LegacyTabRedirect';

/** Legacy deep link → канонический hub (TAB_ALIASES в pushLinks.ts) */
export default function LegacyTabRedirectScreen() {
  return <LegacyTabRedirect path="/(contractor)/(tabs)/works" />;
}
