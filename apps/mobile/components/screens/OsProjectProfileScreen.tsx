/** Профиль объекта — редактирование основных данных проекта (Объект → Профиль) */
import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectProfileFields, type ProjectProfileValues } from '@/components/renova/ProjectProfileFields';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useCustomerBudget } from '@/lib/hooks/useCustomerBudget';
import { canEditProjectProfile } from '@/lib/domain/roleCapabilities';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { useRenova } from '@/lib/context/RenovaContext';
import { isIsoDate } from '@/lib/validateDate';
import type { OsRole } from '@/constants/osSections';
import { screenLayout } from '@/constants/screenLayout';
import { formMetaText } from '@/constants/formTypography';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function OsProjectProfileScreen({
  role,
  onNextTab,
}: {
  role: OsRole;
  onNextTab?: (tab: ObjectTabId) => void;
}) {
  const { activeProject, updateProjectProfile, readOnly, user } = useRenova();
  const canWrite = useWriteAllowed() && canEditProjectProfile({ role, readOnly });
  const { customerBudget } = useCustomerBudget({
    projectId: activeProject?.id,
    userId: user?.id,
    serverBudget: activeProject?.customer_budget,
  });
  const [values, setValues] = useState<ProjectProfileValues | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [budgetDirty, setBudgetDirty] = useState(false);

  const roomsCount = activeProject?.rooms?.length || activeProject?.rooms_count || 0;
  const hasChanges = dirty || budgetDirty;

  useEffect(() => {
    if (!activeProject) {
      setValues(null);
      return;
    }
    setValues({
      name: activeProject.name,
      address: activeProject.address || '',
      renovation_type: activeProject.renovation_type,
      property_type: activeProject.property_type === 'house' ? 'house' : 'apartment',
      planned_start_date: activeProject.planned_start_date || '',
      planned_end_date: activeProject.planned_end_date || '',
    });
    setDirty(false);
  }, [
    activeProject?.id,
    activeProject?.name,
    activeProject?.address,
    activeProject?.renovation_type,
    activeProject?.property_type,
    activeProject?.planned_start_date,
    activeProject?.planned_end_date,
  ]);

  useEffect(() => {
    setBudgetInput(customerBudget ? String(customerBudget) : '');
    setBudgetDirty(false);
  }, [customerBudget, activeProject?.id]);

  if (!activeProject) return <ProjectEmptyState role={role} />;
  if (!values) return null;

  async function onSave() {
    if (!values?.name.trim()) {
      Alert.alert('Укажите название проекта');
      return;
    }
    const start = values.planned_start_date?.trim() || '';
    const end = values.planned_end_date?.trim() || '';
    if (start && !isIsoDate(start)) {
      Alert.alert('Дата старта', 'Формат: YYYY-MM-DD');
      return;
    }
    if (end && !isIsoDate(end)) {
      Alert.alert('Дата финиша', 'Формат: YYYY-MM-DD');
      return;
    }
    if (start && end && start > end) {
      Alert.alert('Сроки', 'Дата старта не может быть позже финиша');
      return;
    }
    setBusy(true);
    try {
      await updateProjectProfile({
        name: values.name.trim(),
        address: values.address.trim() || undefined,
        renovation_type: values.renovation_type,
        property_type: values.property_type,
        planned_start_date: start || null,
        planned_end_date: end || null,
        ...(budgetDirty
          ? { customer_budget: (() => { const n = parseInt(budgetInput.replace(/\s/g, ''), 10); return n > 0 ? n : null; })() }
          : {}),
      });
      if (budgetDirty) setBudgetDirty(false);
      setDirty(false);
      Alert.alert('Сохранено', 'Профиль объекта обновлён');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить. Проверьте подключение к серверу.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      {readOnly && <ReadOnlyBanner />}
      <ObjectTabGuide tab="profile" role={role} onNextTab={onNextTab} compact />
      <ProjectProfileFields
        variant="profile"
        role={role}
        readOnly={!!readOnly}
        values={values}
        showSchedule
        budgetValue={budgetInput}
        estimateTotal={activeProject.budget_planned}
        onBudgetChange={(v) => {
          setBudgetInput(v);
          setBudgetDirty(true);
        }}
        onChange={(patch) => {
          setValues((v) => (v ? { ...v, ...patch } : v));
          setDirty(true);
        }}
      />
      <View style={s.footer}>
        <Pressable
          style={s.roomsLink}
          onPress={() => onNextTab?.('rooms')}
          disabled={!onNextTab}
        >
          <Text style={s.roomsLinkT}>
            {roomsCount} {roomsCount === 1 ? 'комната' : roomsCount < 5 ? 'комнаты' : 'комнат'} → Комнаты
          </Text>
        </Pressable>
        {!hasChanges && !busy ? (
          <Text style={s.savedHint}>Изменений нет</Text>
        ) : null}
        {canWrite ? (
          <PrimaryButton
            title={busy ? 'Сохранение…' : 'Сохранить профиль'}
            onPress={onSave}
            disabled={busy || !hasChanges}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  footer: { marginTop: 4, marginBottom: 16, gap: 10 },
  roomsLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  roomsLinkT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.primary },
  savedHint: { ...formMetaText.caption },
});
