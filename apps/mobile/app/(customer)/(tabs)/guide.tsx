/** Скрытая вкладка «Гид» — единый stack /guide с BackHeader (как из профиля) */
import { Redirect } from 'expo-router';

export default function CustomerGuideTab() {
  return <Redirect href={{ pathname: '/guide', params: { returnTo: '/(customer)/(tabs)/profile' } }} />;
}
