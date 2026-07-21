import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { pushNavHistory } from '@/lib/navHistory';
import { reportCatch } from '@/lib/reportError';

/** Сообщает iphone-preview.html, что UI отрисован */
function pingPreview() {
  if (typeof window !== 'undefined' && window.parent !== window) {
    window.parent.postMessage({ type: 'renova-ready' }, '*');
  }
}

export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    pushNavHistory(path).catch(reportCatch('components.renova.NavTracker.1'));
    const t = setTimeout(pingPreview, 400);
    return () => clearTimeout(t);
  }, [path]);
  return null;
}
