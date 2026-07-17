import { Redirect } from 'expo-router';

/** P3.4: legacy tab «control» → контроль качества */
export default function LegacyControlRedirect() {
  return <Redirect href="/quality-control" />;
}
