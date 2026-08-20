/** Профиль объекта — редактирование основных данных проекта (Объект → Профиль) */
import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { TechnicalSupervisionCard } from '@/components/renova/TechnicalSupervisionCard';
import {
  ProjectProfileFields,
  type ProjectProfileValues,
  type VatRate,
} from '@/components/renova/ProjectProfileFields';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useCustomerBudget } from '@/lib/hooks/useCustomerBudget';
import { parseCustomerBudgetInput } from '@/lib/customerBudgetSync';
import { canEditProjectProfile } from '@/lib/domain/roleCapabilities';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { useRenova } from '@/lib/context/RenovaContext';
import { isIsoDate } from '@/lib/validateDate';
import { reportError } from '@/lib/reportError';
import type { OsRole } from '@/constants/osSections';
import { screenLayout } from '@/constants/screenLayout';
import { formMetaText } from '@/constants/formTypography';
import { alertProjectProfileSaved } from '@/lib/fieldCreateNav';

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

function toVatRate(value: unknown): VatRate {
  return value === 5 || value === 10 || value === 20 ? value : 0;
}

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
    user,
    project: activeProject,
  });
  const [values, setValues] = useState<ProjectProfileValues | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);
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
      vat_rate: toVatRate(activeProject.vat_rate),
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
    activeProject?.vat_rate,
    activeProject?.property_type,
    activeProject?.planned_start_date,
    activeProject?.planned_end_date,
  ]);

  useEffect(() => {
    setBudgetInput(customerBudget ? String(customerBudget) : '');
    setBudgetError(null);
    setBudgetDirty(false);
  }, [customerBudget, activeProject?.id]);

  if (!activeProject) return <ProjectEmptyState role={role} />;
  if (!values) return null;
  const project = activeProject;
  const profileValues = values;
  const canManageTechnicalSupervision =
    role === 'customer'
    && project.access_mode === 'owner'
    && !readOnly;

  async function onSave() {
    const projectId = project.id;
    if (!profileValues.name.trim()) {
      Alert.alert('Укажите название проекта');
      return;
    }
    const start = profileValues.planned_start_date?.trim() || '';
    const end = profileValues.planned_end_date?.trim() || '';
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

    const parsedBudget = budgetDirty ? parseCustomerBudgetInput(budgetInput) : null;
    if (parsedBudget?.error) {
      setBudgetError(parsedBudget.error);
      return;
    }

    setBusy(true);
    try {
      const datesChanged =
        (start || null) !== (project.planned_start_date || null)
        || (end || null) !== (project.planned_end_date || null);
      await updateProjectProfile({
        name: profileValues.name.trim(),
        address: profileValues.address.trim() || null,
        renovation_type: profileValues.renovation_type,
        vat_rate: profileValues.vat_rate ?? 0,
        property_type: profileValues.property_type,
        planned_start_date: start || null,
        planned_end_date: end || null,
        ...(budgetDirty ? { customer_budget: parsedBudget?.value ?? null } : {}),
      });
      if (budgetDirty) setBudgetDirty(false);
      setBudgetError(null);
      setDirty(false);
      // W133: сроки → график
      alertProjectProfileSaved(role, datesChanged);
    } catch (error) {
      reportError('projectProfile.save', error, { projectId });
      Alert.alert('Ошибка', 'Не удалось сохранить. Проверьте подключение к серверу.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      {readOnly && <ReadOnlyBanner />}
      <ObjectTabGuide tab="profile" role={role} onNextTab={onNextTab} />
      <ProjectProfileFields
        variant="profile"
        role={role}
        readOnly={!!readOnly}
        values={profileValues}
        showSchedule
        budgetValue={budgetInput}
        budgetError={budgetError}
        estimateTotal={project.budget_planned}
        onBudgetChange={(v) => {
          setBudgetInput(v);
          setBudgetError(parseCustomerBudgetInput(v).error);
          setBudgetDirty(true);
        }}
        onChange={(patch) => {
          setValues((v) => (v ? { ...v, ...patch } : v));
          setDirty(true);
        }}
      />
      {user?.id ? (
        <TechnicalSupervisionCard
          userId={user.id}
          projectId={project.id}
          canManage={canManageTechnicalSupervision}
        />
      ) : null}
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
            disabled={busy || !hasChanges || !!budgetError}
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
