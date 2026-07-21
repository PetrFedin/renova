/** Гид — stack-экран из профиля (заказчик и исполнитель) */
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { GuideScreen } from '@/components/screens/GuideScreen';

export default function GuideRoute() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return (
    <>
      <BackHeader title="Гид по ремонту" returnTo={returnTo} />
      <GuideScreen />
    </>
  );
}
