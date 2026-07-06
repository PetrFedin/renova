import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { pushNavHistory } from '@/lib/navHistory';

/** Сообщает iphone-preview.html, что UI отрисован */
function pingPreview() {
  if (typeof window !== 'undefined' && window.parent !== window) {
    window.parent.postMessage({ type: 'renova-ready' }, '*');
  }
}

export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    pushNavHistory(path).catch(() => {});
    const t = setTimeout(pingPreview, 400);
    return () => clearTimeout(t);
  }, [path]);
  return null;
}
