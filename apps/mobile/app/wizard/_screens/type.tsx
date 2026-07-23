import { useState } from 'react';
import { View, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectProfileFields } from '@/components/renova/ProjectProfileFields';
import { useRenova } from '@/lib/context/RenovaContext';
import { DEFAULT_QUICK_AREA, WIZARD_MODE_LABEL, type WizardMode } from '@/lib/wizard/wizardMode';
import { buildQuickWizardRooms, quickWizardFloorSqM } from '@/lib/wizard/buildQuickWizardRooms';
import { WizardHint } from '@/components/renova/wizard/WizardHint';

export default function WizardType() {
  const { wizard, setWizard } = useRenova();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<WizardMode>(wizard.wizard_mode || 'quick');
  const [quickArea, setQuickArea] = useState(
    String(DEFAULT_QUICK_AREA[wizard.property_type] || DEFAULT_QUICK_AREA.apartment),
  );

  const canNext = Boolean(wizard.name?.trim());

  const goDetailedRooms = () => {
    const name = wizard.name?.trim();
    if (!name) {
      Alert.alert('Название объекта', 'Укажите название — например «Квартира на Ленина»');
      return;
    }
    setWizard({ wizard_mode: 'detailed' });
    router.navigate('/wizard/rooms');
  };

  const goQuickConfirm = () => {
    const name = wizard.name?.trim();
    if (!name) {
      Alert.alert('Название объекта', 'Укажите название — например «Квартира на Ленина»');
      return;
    }
    const sqm = parseFloat(quickArea.replace(',', '.')) || DEFAULT_QUICK_AREA[wizard.property_type];
    const rooms = buildQuickWizardRooms(wizard.property_type, sqm);
    setWizard({ wizard_mode: 'quick', rooms });
    router.navigate({ pathname: '/wizard/[step]', params: { step: 'confirm', quickSqm: String(sqm) } });
  };

  const onPrimary = () => {
    if (mode === 'quick') goQuickConfirm();
    else goDetailedRooms();
  };

  const previewSqm = mode === 'quick'
    ? quickWizardFloorSqM(buildQuickWizardRooms(wizard.property_type, parseFloat(quickArea.replace(',', '.')) || DEFAULT_QUICK_AREA[wizard.property_type]))
    : null;

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
          <Text style={styles.modeHead}>Как создать объект?</Text>
          <WizardHint
            brief="Быстро — за минуту, подробно — комнаты вручную."
            detailed="Быстрый режим: тип, площадь и шаблон комнат → черновик сметы за минуту. Подробный — как раньше, с настройкой каждой комнаты."
          />
          <View style={styles.modeRow}>
            {(['quick', 'detailed'] as WizardMode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.modeChip, mode === m && styles.modeChipOn]}
                onPress={() => {
                  setMode(m);
                  setWizard({ wizard_mode: m });
                }}
              >
                <Text style={[styles.modeChipT, mode === m && styles.modeChipTOn]}>{WIZARD_MODE_LABEL[m]}</Text>
              </Pressable>
            ))}
          </View>
          {mode === 'quick' ? (
            <Text style={styles.modeHint}>
              Тип, площадь и шаблон комнат — сразу к смете. Комнаты можно уточнить позже в «Квартира».
            </Text>
          ) : (
            <Text style={styles.modeHint}>Пошагово: профиль → комнаты → смета.</Text>
          )}

          <ProjectProfileFields values={wizard} showSchedule onChange={(patch) => setWizard(patch)} />

          {mode === 'quick' ? (
            <View style={styles.quickBox}>
              <Text style={styles.quickLabel}>Общая площадь, м²</Text>
              <TextInput
                style={styles.quickInput}
                keyboardType="decimal-pad"
                value={quickArea}
                onChangeText={setQuickArea}
                placeholder={String(DEFAULT_QUICK_AREA.apartment)}
              />
              {previewSqm ? (
                <Text style={styles.quickPreview}>Шаблон: {Math.round(previewSqm)} м² · {wizard.property_type === 'house' ? 7 : 5} комнат</Text>
              ) : null}
              <Pressable onPress={() => { setMode('detailed'); setWizard({ wizard_mode: 'detailed' }); goDetailedRooms(); }}>
                <Text style={styles.link}>Настроить комнаты подробнее →</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!canNext ? (
            <Text style={styles.validation}>Укажите название объекта — без него нельзя перейти дальше.</Text>
          ) : null}
          <PrimaryButton
            title={mode === 'quick' ? 'К смете' : 'Далее: комнаты'}
            onPress={onPrimary}
            disabled={!canNext}
            fullWidth
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  scrollContent: { padding: 16, paddingBottom: 24 },
  modeHead: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    alignItems: 'center',
    backgroundColor: RenovaTheme.colors.surface,
  },
  modeChipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  modeChipT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  modeChipTOn: { color: RenovaTheme.colors.primary },
  modeHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 12, lineHeight: 17 },
  quickBox: { marginTop: 8, padding: 12, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surfaceMuted, gap: 8 },
  quickLabel: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  quickInput: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    padding: 10,
    fontSize: 16,
    backgroundColor: RenovaTheme.colors.surface,
  },
  quickPreview: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  link: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.accent, marginTop: 4 },
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
