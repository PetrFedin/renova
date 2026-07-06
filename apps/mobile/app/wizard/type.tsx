import { View, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectProfileFields } from '@/components/renova/ProjectProfileFields';
import { useRenova } from '@/lib/context/RenovaContext';

export default function WizardType() {
  const { wizard, setWizard } = useRenova();
  const insets = useSafeAreaInsets();

  const canNext = Boolean(wizard.name?.trim());

  const onNext = () => {
    const name = wizard.name?.trim();
    if (!name) {
      Alert.alert('Название объекта', 'Укажите название — например «Квартира на Ленина»');
      return;
    }
    router.navigate('/wizard/rooms');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ProjectProfileFields values={wizard} showSchedule onChange={(patch) => setWizard(patch)} />
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!canNext ? (
            <Text style={styles.validation}>Укажите название объекта — без него нельзя перейти дальше.</Text>
          ) : null}
          <PrimaryButton title="Далее" onPress={onNext} disabled={!canNext} fullWidth />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  scrollContent: { padding: 16, paddingBottom: 24 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
    backgroundColor: RenovaTheme.colors.background,
    gap: 8,
  },
  validation: {
    fontSize: 12,
    color: RenovaTheme.colors.warning,
    textAlign: 'center',
    lineHeight: 16,
  },
});
