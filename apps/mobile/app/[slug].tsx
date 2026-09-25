import { AppCatchAllScreen } from './_stack/AppCatchAllScreen';

/**
 * P3-W52: root catch-all — stack screens + legacy/registry redirects.
 * Неизвестные slug → честный 404 (не «второй продукт»).
 *
 * Fix: actual rendering lives in AppCatchAllScreen, shared with
 * app/(contractor)/[tool].tsx — see that file's docblock for why sharing
 * this is required (route-group path collision between the two catch-alls).
 */
export default function RootSlugCatchAll() {
  return <AppCatchAllScreen />;
}
