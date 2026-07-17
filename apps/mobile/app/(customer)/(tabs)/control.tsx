import { Redirect } from 'expo-router';

/** P3.4: legacy control tab → quality-control hub */
export default function ControlTabRedirect() {
  return <Redirect href="/quality-control" />;
}
