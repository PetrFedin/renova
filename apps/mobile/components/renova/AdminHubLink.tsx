/** Web-only ссылки на внутренние admin-экраны. Видимы только после backend RBAC probe. */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useNavFromHere } from '@/lib/navigation';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';

export function AdminHubLink() {
  const nav = useNavFromHere();
  const { user } = useRenova();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'web' || !user?.id) {
      setAllowed(false);
      return () => { cancelled = true; };
    }
    // Do not infer admin rights in the client. The canonical backend RBAC decides.
    api.getAdminStats(user.id)
      .then(() => { if (!cancelled) setAllowed(true); })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (Platform.OS !== 'web' || !allowed) return null;

  return (
    <>
      <PrimaryButton title="Operations Center" variant="outline" onPress={() => nav.href('/(contractor)/admin-dashboard')} />
      <PrimaryButton title="Админ: статистика" variant="outline" onPress={() => nav.href('/(contractor)/admin')} />
      <PrimaryButton title="Админ: статьи" variant="outline" onPress={() => nav.href('/(contractor)/articles-admin')} />
    </>
  );
}
