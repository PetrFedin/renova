import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, type TechnicalSupervisionProviderType, type TechnicalSupervisionStatus } from '@/lib/api';
import { RenovaTheme, card } from '@/constants/Theme';
import { reportError } from '@/lib/reportError';

export function TechnicalSupervisionCard({
  userId,
  projectId,
  canManage,
}: {
  userId: string;
  projectId: string;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<TechnicalSupervisionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileCode, setProfileCode] = useState('');
  const [providerType, setProviderType] = useState<TechnicalSupervisionProviderType>('individual');
  const [providerName, setProviderName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getTechnicalSupervision(userId, projectId);
      setStatus(next);
      if (next.active) {
        setProfileCode(next.active.representative_profile_code || '');
        setProviderType(next.active.provider_type);
        setProviderName(next.active.provider_name || '');
      } else {
        setProfileCode('');
        setProviderType('individual');
        setProviderName('');
      }
    } catch (cause) {
      reportError('technicalSupervision.load', cause, { projectId });
      setError('Не удалось загрузить технический надзор. Данные не изменены.');
    } finally {
      setLoading(false);
    }
  }, [projectId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function persistAssignment() {
    const code = profileCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('Технический надзор', 'Укажите код профиля представителя Renova.');
      return;
    }
    if (providerType === 'company' && !providerName.trim()) {
      Alert.alert('Технический надзор', 'Укажите название компании.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.setTechnicalSupervision(userId, projectId, {
        profile_code: code,
        provider_type: providerType,
        provider_name: providerName.trim() || null,
        expected_assignment_id: status?.active?.id || null,
      });
      await load();
      Alert.alert(
        'Технический надзор',
        result.replayed ? 'Назначение уже актуально.' : 'Назначение сохранено.',
      );
    } catch (cause) {
      reportError('technicalSupervision.assign', cause, { projectId });
      setError('Не удалось изменить назначение. Обновите данные и повторите действие.');
    } finally {
      setBusy(false);
    }
  }

  function saveAssignment() {
    if (status?.active) {
      Alert.alert(
        'Заменить технический надзор?',
        'Предыдущее назначение останется в истории, а его доступ будет отозван сразу после замены.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Заменить', onPress: () => void persistAssignment() },
        ],
      );
      return;
    }
    void persistAssignment();
  }

  function revokeAssignment() {
    const active = status?.active;
    if (!active) return;
    Alert.alert(
      'Отозвать технический надзор?',
      'Представитель потеряет доступ к объекту и техническим действиям. История назначения сохранится.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отозвать',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await api.revokeTechnicalSupervision(userId, projectId, active.id);
              await load();
            } catch (cause) {
              reportError('technicalSupervision.revoke', cause, { projectId });
              setError('Не удалось отозвать назначение. Обновите данные и повторите действие.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={s.block}>
      <View style={s.headerRow}>
        <View style={s.headerText}>
          <Text style={s.title}>Технический надзор</Text>
          <Text style={s.subtitle}>
            Независимый контроль работ, материалов, замечаний, графика и общения с исполнителем.
          </Text>
        </View>
        {status?.active ? <Text style={s.badge}>Назначен</Text> : null}
      </View>

      <View style={s.boundary}>
        <Text style={s.boundaryText}>
          Технадзор не получает право на платежи, фиксацию сметы, смену подрядчика или финальную приёмку от имени заказчика.
        </Text>
      </View>

      {loading ? <Text style={s.muted}>Загрузка назначения…</Text> : null}
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} disabled={loading || busy}>
            <Text style={s.retry}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && status?.active ? (
        <View style={s.current}>
          <Text style={s.currentName}>{status.active.provider_name}</Text>
          <Text style={s.muted}>
            {status.active.provider_type === 'company' ? 'Компания' : 'Специалист'}
            {status.active.representative_full_name
              ? ` · ${status.active.representative_full_name}`
              : ''}
          </Text>
          {status.active.representative_profile_code ? (
            <Text style={s.code}>Код: {status.active.representative_profile_code}</Text>
          ) : null}
        </View>
      ) : null}

      {!loading && !error && !status?.active ? (
        <Text style={s.muted}>Технический надзор не назначен.</Text>
      ) : null}

      {canManage && !loading && !error ? (
        <View style={s.form}>
          <Text style={s.label}>{status?.active ? 'Заменить представителя' : 'Назначить представителя'}</Text>
          <TextInput
            value={profileCode}
            onChangeText={(value: string) => setProfileCode(value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            placeholder="Код профиля Renova"
            placeholderTextColor={RenovaTheme.colors.textSubtle}
            style={s.input}
            editable={!busy}
          />
          <View style={s.segmentRow}>
            {(['individual', 'company'] as TechnicalSupervisionProviderType[]).map((value) => (
              <Pressable
                key={value}
                onPress={() => setProviderType(value)}
                disabled={busy}
                style={[s.segment, providerType === value && s.segmentActive]}
              >
                <Text style={[s.segmentText, providerType === value && s.segmentTextActive]}>
                  {value === 'individual' ? 'Человек' : 'Компания'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={providerName}
            onChangeText={setProviderName}
            placeholder={providerType === 'company' ? 'Название компании' : 'Имя / название для объекта'}
            placeholderTextColor={RenovaTheme.colors.textSubtle}
            style={s.input}
            maxLength={255}
            editable={!busy}
          />
          <Pressable
            onPress={saveAssignment}
            disabled={busy}
            style={[s.primary, busy && s.disabled]}
          >
            <Text style={s.primaryText}>
              {busy ? 'Сохранение…' : status?.active ? 'Заменить технадзор' : 'Назначить технадзор'}
            </Text>
          </Pressable>
          {status?.active ? (
            <Pressable onPress={revokeAssignment} disabled={busy} style={s.dangerButton}>
              <Text style={s.dangerText}>Отозвать полномочия</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  block: { ...card, marginTop: RenovaTheme.spacing.md },
  headerRow: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, alignItems: 'flex-start' },
  headerText: { flex: 1 },
  title: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { marginTop: 4, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  badge: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.successText, backgroundColor: RenovaTheme.colors.successBg, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  boundary: { marginTop: 10, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder, backgroundColor: RenovaTheme.colors.infoBg, borderRadius: RenovaTheme.radius.sm, padding: 10 },
  boundaryText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.infoText, lineHeight: 17 },
  current: { marginTop: 12, padding: 10, backgroundColor: RenovaTheme.colors.surfaceMuted, borderRadius: RenovaTheme.radius.sm },
  currentName: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  muted: { marginTop: 8, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  code: { marginTop: 4, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  form: { marginTop: 14, gap: 8 },
  label: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  input: { minHeight: 44, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.sm, paddingHorizontal: 12, paddingVertical: 10, color: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.surface },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.sm },
  segmentActive: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.surfaceMuted },
  segmentText: { color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.medium },
  segmentTextActive: { color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
  primary: { minHeight: 44, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: RenovaTheme.colors.inverseText, fontWeight: RenovaTheme.fontWeight.semibold },
  disabled: { opacity: 0.55 },
  dangerButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.semibold },
  errorBox: { marginTop: 10, borderWidth: 1, borderColor: RenovaTheme.colors.dangerBorder, backgroundColor: RenovaTheme.colors.dangerBg, borderRadius: RenovaTheme.radius.sm, padding: 10 },
  errorText: { color: RenovaTheme.colors.dangerText, fontSize: RenovaTheme.fontSize.bodySmall },
  retry: { marginTop: 8, color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
});
