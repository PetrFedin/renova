/** Web-only ссылки на внутренние admin-экраны */
import { Platform } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useNavFromHere } from '@/lib/navigation';

export function AdminHubLink() {
  const nav = useNavFromHere();
  if (Platform.OS !== 'web') return null;

  return (
    <>
      <PrimaryButton title="Админ: статистика" variant="outline" onPress={() => nav.href('/(contractor)/admin')} />
      <PrimaryButton title="Админ: панель" variant="outline" onPress={() => nav.href('/(contractor)/admin-dashboard')} />
      <PrimaryButton title="Админ: статьи" variant="outline" onPress={() => nav.href('/(contractor)/articles-admin')} />
    </>
  );
}
