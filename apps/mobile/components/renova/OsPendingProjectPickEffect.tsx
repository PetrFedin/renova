/** Редирект на выбор объекта, если сессия пометила pendingProjectPick */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRenova } from '@/lib/context/RenovaContext';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { projectPickRoute } from '@/lib/osEntry';
import { replaceOsNav } from '@/lib/pushOsNav';

export function OsPendingProjectPickEffect() {
  const pathname = usePathname();
  const { user, activeProject } = useRenova();
  const [pendingPick, setPendingPick] = useState(false);
  const pickNavLock = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((v) => {
      const next = v === '1';
      setPendingPick((prev) => (prev === next ? prev : next));
    });
  }, [pathname, activeProject?.id, user?.id]);

  useEffect(() => {
    if (!user || activeProject || !pendingPick) {
      pickNavLock.current = false;
      return;
    }
    if (pathname.includes('/onboarding/')) return;
    // Профиль — единственный экран, который осмыслен без объекта: там карточка
    // компании, бригада и выход. Возврат отсюда на выбор объекта замыкал
    // новую организацию в экране, где выбирать нечего.
    if (pathname.endsWith('/profile')) return;
    if (pickNavLock.current) return;
    pickNavLock.current = true;
    replaceOsNav(projectPickRoute());
  }, [user?.id, activeProject?.id, pendingPick, pathname]);

  return null;
}
