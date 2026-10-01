/** Web-only ссылки на внутренние admin-экраны */
import { Platform } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useNavFromHere } from '@/lib/navigation';
import { useAdminAccess } from '@/lib/hooks/useAdminAccess';

export function AdminHubLink() {
  const nav = useNavFromHere();
  const access = useAdminAccess();
  if (Platform.OS !== 'web' || access !== 'granted') return null;

  return (
    <>
      <PrimaryButton title="Админ: статистика" variant="outline" onPress={() => nav.href('/admin')} />
      <PrimaryButton title="Админ: панель" variant="outline" onPress={() => nav.href('/admin-dashboard')} />
      <PrimaryButton title="Админ: статьи" variant="outline" onPress={() => nav.href('/articles-admin')} />
      <PrimaryButton title="Админ: возвраты подписки" variant="outline" onPress={() => nav.href('/refund-reviews')} />
      <PrimaryButton title="Админ: сверка провайдеров" variant="outline" onPress={() => nav.href('/provider-reconciliations')} />
    </>
  );
}
