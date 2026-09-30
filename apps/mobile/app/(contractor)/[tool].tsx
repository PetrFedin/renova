import { AppCatchAllScreen } from '../_stack/AppCatchAllScreen';

/**
 * P3-W39: contractor tools → один catch-all.
 *
 * Админ/подписка/team-qr/audit теперь статические root-файлы (app/admin.tsx, …):
 * динамический `/:tool` конфликтовал с [slug] и (tabs)/[legacyTab].
 *
 * Fix: `(contractor)` is a route GROUP, invisible in the URL, so this
 * file's `/:tool` pattern matches the exact same single-segment paths as
 * the root `app/[slug].tsx` catch-all (e.g. `/job-leads`, `/reports`,
 * `/guide`, `/scratchpad`, …). Which of the two expo-router resolves a
 * given push to is not something we can rely on. This file used to
 * unconditionally <Redirect href="/(contractor)/(tabs)" /> for any segment
 * outside its own small MAP — so whenever expo-router picked THIS route
 * for a STACK_KEYS path, contractors got silently bounced back into the
 * tabs Slot instead of reaching the intended screen, and re-rendering
 * side effects on that Slot produced a "Maximum update depth exceeded"
 * loop. Falling through to the shared AppCatchAllScreen (same component
 * app/[slug].tsx renders) makes both catch-alls behave identically, so
 * the result is correct regardless of which one wins the match.
 */
export default function ContractorTool() {
  return <AppCatchAllScreen />;
}
