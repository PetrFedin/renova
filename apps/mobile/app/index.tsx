import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { osEntryRoute } from '@/lib/osEntry';

export default function Index() {
  const { loading, user } = useRenova();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
        <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/onboarding/role" />;

  return <Redirect href={osEntryRoute(user.role === 'contractor' ? 'contractor' : 'customer') as any} />;
}
