/**
 * Портал / приложение: подтверждение ручного перевода (квитанция).
 * Submit → paid_unverified. Никогда не auto-confirmed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { api, ApiError } from '@/lib/api';
import type { Payment } from '@/lib/api/types';
import { pickDocumentForUpload } from '@/lib/documentUploadPick';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

type Step = 'form' | 'uploading' | 'done' | 'review';

type Props = {
  visible: boolean;
  userId: string;
  projectId: string;
  payment: Payment;
  role: 'customer' | 'contractor';
  requisitesText?: string;
  onClose: () => void;
  onDone: () => void;
};

function newIdemKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* ignore */ }
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PortalPaymentEvidenceSheet({
  visible, userId, projectId, payment, role, requisitesText, onClose, onDone,
}: Props) {
  const [step, setStep] = useState<Step>('form');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [claimedAmount, setClaimedAmount] = useState(String(Math.round(payment.amount)));
  const [comment, setComment] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [idemKey, setIdemKey] = useState<string | null>(null);
  const [evidenceMeta, setEvidenceMeta] = useState<Awaited<ReturnType<typeof api.getPaymentEvidence>> | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isCustomer = role === 'customer';
  const isReviewer = role === 'contractor';

  const reload = useCallback(async () => {
    try {
      const meta = await api.getPaymentEvidence(userId, projectId, payment.id);
      setEvidenceMeta(meta);
      if (isReviewer && meta.payment.status === 'paid_unverified') setStep('review');
      else if (meta.payment.status === 'paid_unverified' || meta.payment.status === 'confirmed') setStep('done');
      else if (meta.payment.status === 'rejected') setStep('form');
    } catch { /* first open */ }
  }, [userId, projectId, payment.id, isReviewer]);

  useEffect(() => {
    if (!visible) return;
    setStep(isReviewer ? 'review' : 'form');
    setClaimedAmount(String(Math.round(payment.amount)));
    setFile(null);
    setErrors([]);
    setIdemKey(null);
    setBusy(false);
    void reload();
  }, [visible, payment.id, payment.amount, isReviewer, reload]);

  const timeline = useMemo(() => {
    const st = evidenceMeta?.payment.status || payment.status;
    const ev = evidenceMeta?.evidence;
    return [
      { id: 'req', label: 'Реквизиты получены', done: true },
      { id: 'mark', label: 'Перевод отмечен', done: ['paid_unverified', 'confirmed', 'rejected'].includes(st) || Boolean(ev) },
      { id: 'file', label: 'Квитанция отправлена', done: Boolean(ev) },
      {
        id: 'final',
        label: st === 'rejected' ? 'Отклонён' : st === 'confirmed' ? 'Подтверждён' : 'Ожидает проверки',
        done: st === 'confirmed' || st === 'rejected',
      },
    ];
  }, [evidenceMeta, payment.status]);

  const validate = (): string[] => {
    const e: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) e.push('Укажите дату перевода (ГГГГ-ММ-ДД)');
    const amt = Number(claimedAmount.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) e.push('Укажите сумму перевода');
    if (!file) e.push('Приложите PDF или фото квитанции (JPG/PNG)');
    else if (!/(pdf|jpe?g|png)$/i.test(file.name) && !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      e.push('Допустимы только PDF, JPG, JPEG, PNG');
    }
    return e;
  };

  const pickFile = async () => {
    const picked = await pickDocumentForUpload();
    if (!picked) return;
    const ok =
      ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'].includes(picked.type)
      || /\.(pdf|jpe?g|png)$/i.test(picked.name);
    if (!ok) {
      Alert.alert('Файл', 'Поддерживаются PDF, JPG, JPEG, PNG');
      return;
    }
    setFile(picked);
    setErrors((prev) => prev.filter((x) => !x.includes('Приложите') && !x.includes('Допустимы')));
  };

  const submit = async (reuseKey: boolean) => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    if (busy || step === 'uploading') return;
    const key = reuseKey && idemKey ? idemKey : newIdemKey();
    setIdemKey(key);
    setBusy(true);
    setStep('uploading');
    try {
      const res = await api.submitPaymentEvidence(userId, projectId, payment.id, {
        file: file!,
        transferDate,
        claimedAmount: Number(claimedAmount.replace(',', '.')),
        comment: comment.trim() || undefined,
        paymentReference: reference.trim() || undefined,
        clientRequestId: key,
        expectedLockVersion: payment.lock_version,
      });
      setIdemKey(null);
      setStep('done');
      Alert.alert('Готово', res.message || 'Подтверждение отправлено. Платёж ожидает проверки');
      onDone();
    } catch (e) {
      setStep('form');
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Конфликт', e.message);
        setIdemKey(null);
      } else {
        Alert.alert(
          'Не удалось отправить',
          e instanceof Error ? e.message : 'Ошибка сети',
          [
            { text: 'Отмена', style: 'cancel', onPress: () => setIdemKey(null) },
            { text: 'Повторить', onPress: () => { void submit(true); } },
          ],
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (busy) return;
    const meta = evidenceMeta;
    if (!meta?.evidence) return;
    Alert.alert(
      'Подтвердить оплату?',
      `Счёт: ${formatRub(payment.amount)}\nЗаявлено: ${formatRub(meta.evidence.claimed_amount)}\nДата: ${meta.evidence.transfer_date}\nФайл: ${meta.evidence.original_filename}\nОтправитель: ${meta.evidence.uploaded_by.slice(0, 8)}…`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подтвердить',
          onPress: async () => {
            setBusy(true);
            try {
              await api.approvePaymentEvidence(userId, projectId, payment.id, {
                expected_lock_version: meta.payment.lock_version,
              });
              Alert.alert('Оплата подтверждена', payment.title);
              onDone();
              onClose();
            } catch (e) {
              Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const reject = async () => {
    if (busy) return;
    if (rejectReason.trim().length < 3) {
      Alert.alert('Причина', 'Укажите причину отклонения');
      return;
    }
    setBusy(true);
    try {
      await api.rejectPaymentEvidence(userId, projectId, payment.id, {
        reason: rejectReason.trim(),
        expected_lock_version: evidenceMeta?.payment.lock_version,
      });
      Alert.alert('Отклонено', 'Заказчик получит уведомление');
      onDone();
      onClose();
    } catch (e) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet} accessibilityLabel="Подтверждение перевода">
          <View style={s.head}>
            <Text style={s.title}>Подтверждение перевода</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть">
              <Text style={s.close}>Закрыть</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.payTitle}>{payment.title} · {formatRub(payment.amount)}</Text>
            <Text style={s.status}>Статус: {payment.status}</Text>

            <View style={s.timeline} accessibilityLabel="Хронология оплаты">
              {timeline.map((t) => (
                <Text key={t.id} style={[s.tlItem, t.done && s.tlDone]}>
                  {t.done ? '✓' : '○'} {t.label}
                </Text>
              ))}
            </View>

            {requisitesText ? (
              <Text style={s.muted} accessibilityLabel="Реквизиты для перевода">{requisitesText}</Text>
            ) : null}

            {evidenceMeta?.evidence?.reject_reason ? (
              <View style={s.rejectBox}>
                <Text style={s.rejectTitle}>Отклонено</Text>
                <Text style={s.rejectBody}>{evidenceMeta.evidence.reject_reason}</Text>
                {isCustomer ? <Text style={s.muted}>Можно отправить квитанцию снова</Text> : null}
              </View>
            ) : null}

            {isCustomer && step !== 'done' && step !== 'review' ? (
              <>
                <Text style={s.label}>Дата перевода *</Text>
                <TextInput
                  style={s.input}
                  value={transferDate}
                  onChangeText={setTransferDate}
                  placeholder="ГГГГ-ММ-ДД"
                  accessibilityLabel="Дата перевода"
                  editable={!busy}
                />
                <Text style={s.label}>Сумма перевода *</Text>
                <TextInput
                  style={s.input}
                  value={claimedAmount}
                  onChangeText={setClaimedAmount}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Сумма перевода"
                  editable={!busy}
                />
                <Text style={s.label}>Назначение / reference</Text>
                <TextInput
                  style={s.input}
                  value={reference}
                  onChangeText={setReference}
                  accessibilityLabel="Назначение платежа"
                  editable={!busy}
                />
                <Text style={s.label}>Комментарий</Text>
                <TextInput
                  style={[s.input, { minHeight: 64 }]}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  accessibilityLabel="Комментарий"
                  editable={!busy}
                />
                <PrimaryButton
                  title={file ? `Файл: ${file.name}` : 'Приложить PDF / JPG / PNG *'}
                  variant="outline"
                  onPress={() => { void pickFile(); }}
                  disabled={busy}
                />
                {errors.map((e) => (
                  <Text key={e} style={s.err}>{e}</Text>
                ))}
                {step === 'uploading' ? (
                  <View style={s.progress}>
                    <ActivityIndicator color={RenovaTheme.colors.primary} />
                    <Text style={s.muted}>Загрузка… не закрывайте окно</Text>
                  </View>
                ) : (
                  <PrimaryButton
                    title="Я перевёл — отправить квитанцию"
                    onPress={() => { void submit(false); }}
                    loading={busy}
                    disabled={busy}
                  />
                )}
                <Text style={s.hint}>Отправка квитанции не подтверждает оплату автоматически — исполнитель проверит перевод.</Text>
              </>
            ) : null}

            {isCustomer && step === 'done' ? (
              <Text style={s.okMsg}>Подтверждение отправлено. Платёж ожидает проверки.</Text>
            ) : null}

            {isReviewer && evidenceMeta?.evidence && payment.status === 'paid_unverified' ? (
              <View style={s.reviewBox}>
                <Text style={s.label}>На проверке</Text>
                <Text style={s.muted}>Счёт: {formatRub(payment.amount)}</Text>
                <Text style={s.muted}>Заявлено: {formatRub(evidenceMeta.evidence.claimed_amount)}</Text>
                <Text style={s.muted}>Дата: {evidenceMeta.evidence.transfer_date}</Text>
                <Text style={s.muted}>Файл: {evidenceMeta.evidence.original_filename}</Text>
                <Text style={s.muted}>Отправитель: {evidenceMeta.evidence.uploaded_by.slice(0, 8)}…</Text>
                <Text style={s.hint}>Антивирус: не настроен (файл не сканировался автоматически)</Text>
                <TextInput
                  style={s.input}
                  placeholder="Причина отклонения *"
                  value={rejectReason}
                  onChangeText={setRejectReason}
                />
                <PrimaryButton title="Подтвердить оплату" onPress={() => { void approve(); }} disabled={busy} loading={busy} />
                <PrimaryButton title="Отклонить" variant="outline" onPress={() => { void reject(); }} disabled={busy} />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: RenovaTheme.colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text },
  close: { color: RenovaTheme.colors.primaryMuted, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  payTitle: { fontSize: 16, fontWeight: '700', color: RenovaTheme.colors.text },
  status: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  timeline: { ...card, gap: 4, padding: 12 },
  tlItem: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  tlDone: { color: RenovaTheme.colors.text, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: RenovaTheme.colors.surface,
    color: RenovaTheme.colors.text,
  },
  err: { color: RenovaTheme.colors.dangerText, fontSize: 12 },
  muted: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  progress: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  okMsg: { fontSize: 14, fontWeight: '600', color: RenovaTheme.colors.text },
  rejectBox: { ...card, padding: 12, gap: 4, borderColor: RenovaTheme.colors.dangerText },
  rejectTitle: { fontWeight: '700', color: RenovaTheme.colors.dangerText },
  rejectBody: { color: RenovaTheme.colors.text },
  reviewBox: { gap: 8 },
});
