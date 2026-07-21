/** Портфель проектов заказчика */
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PortfolioProjectsView } from '@/components/renova/os/PortfolioProjectsView';
import { RenovaTheme } from '@/constants/Theme';

export default function PortfolioScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return (
    <>
      <BackHeader title="Портфель проектов" returnTo={returnTo} subtitle="Выберите объекты · план и факт · перерасход по статьям" />
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <PortfolioProjectsView />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
});
