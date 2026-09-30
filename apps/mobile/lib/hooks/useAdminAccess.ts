import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';

/**
 * На клиенте нет признака админа (User.role = customer|contractor; админство
 * решает backend: require_admin_user → 403). Единственный честный источник —
 * сам backend, поэтому пробуем /admin/stats и показываем админские пункты
 * только после подтверждённого 200. Результат кэшируется по user.id.
 */
export type AdminAccess = 'unknown' | 'granted' | 'denied';

const cache = new Map<string, AdminAccess>();

export function useAdminAccess(): AdminAccess {
  const { user } = useRenova();
  const uid = user?.id;
  const [state, setState] = useState<AdminAccess>(uid ? cache.get(uid) ?? 'unknown' : 'denied');

  useEffect(() => {
    if (!uid) { setState('denied'); return; }
    const hit = cache.get(uid);
    if (hit) { setState(hit); return; }
    let alive = true;
    api.getAdminStats(uid)
      .then(() => 'granted' as const, () => 'denied' as const)
      .then((r) => { cache.set(uid, r); if (alive) setState(r); });
    return () => { alive = false; };
  }, [uid]);

  return state;
}
