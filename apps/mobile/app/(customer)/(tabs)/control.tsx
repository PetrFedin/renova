import { Redirect } from 'expo-router';

/** P3.4: legacy tab «control» → приёмка работ */
export default function LegacyControlRedirect() {
  return <Redirect href="/work-acceptance" />;
}
