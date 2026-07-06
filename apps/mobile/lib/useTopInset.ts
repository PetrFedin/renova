/** Отступ сверху под status bar / notch */
import { Platform, StatusBar } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';

/** Для полноэкранного web с ?preview=1 (без iframe-рамки) */
export const IPHONE_PREVIEW_TOP = 52;
/** Отступ снизу под home indicator в preview-рамке */
export const IPHONE_PREVIEW_BOTTOM = 30;

const IOS_FALLBACK = initialWindowMetrics?.insets.top ?? 47;
const ANDROID_FALLBACK = StatusBar.currentHeight ?? 24;

function isInPreviewIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

function webTopInset(): number {
  if (typeof window === 'undefined') return 0;
  // iphone-preview.html уже сдвигает iframe ниже notch — не дублируем
  if (isInPreviewIframe()) return 0;
  const q = new URLSearchParams(window.location.search);
  if (q.get('preview') === '1') return IPHONE_PREVIEW_TOP;
  return 12;
}

export function useTopInset(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return webTopInset();

  const statusBar = Constants.statusBarHeight ?? 0;
  const fallback = Platform.OS === 'ios'
    ? Math.max(IOS_FALLBACK, statusBar, 51)
    : Math.max(ANDROID_FALLBACK, statusBar, 24);

  return Math.max(insets.top, fallback);
}


export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') {
    if (isInPreviewIframe()) return IPHONE_PREVIEW_BOTTOM;
    return 12;
  }
  return Math.max(insets.bottom, 12);
}
