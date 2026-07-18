import { LegacyTabRedirect } from '@/components/routing/LegacyTabRedirect';

/** P3.4c / P3-W28: единый redirect через TAB_ALIASES */
export default function ControlTabRedirect() {
  return <LegacyTabRedirect path="/(customer)/(tabs)/control" />;
}
