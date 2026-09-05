/** Manual bank-transfer evidence lifecycle inside Budget/Payments. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { InfoBanner } from '@/components/ui/InfoBanner';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { api, ApiError, type Payment, type PaymentEvidence } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formatPhone';
import { reportError } from '@/lib/reportError';

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function evidenceStatus(row: PaymentEvidence): { title: string; message: string; tone: 'info' | 'warning' } {
  if (row.status === 'rejected') {
    return {
      title: `Подтверждение отклонено · версия ${row.version}`,
      message: row.rejection_reason || 'Причина не указана. Загрузите новую версию подтверждения.',
      tone: 'warning',
    };
  }
  if (row.status === 'approved') {
    return {
      title: `Подтверждение принято · версия ${row.version}`,
      message: 'Проверка завершена. Статус оплаты обновляется по данным сервера.',
      tone: 'info',
    };
  }
  if (row.status === 'submitted') {
    return {
      title: `На проверке · версия ${row.version}`,
      message: 'Файл принят сервером и ожидает проверки. Сумма ещё не считается подтверждённым расходом.',
      tone: 'info',
    };
  }
  return {
    title: `Загрузка не завершена · версия ${row.version}`,
    message: `Повторно выберите файл «${row.original_filename}» и продолжите отправку. Оплата не будет показана подтверждённой раньше времени.`,
    tone: 'warning',
  };
}

function evidenceStatusLabel(status: PaymentEvidence['status']): string {
  if (status === 'upload_pending') return 'загрузка не завершена';
  if (status === 'submitted') return 'на проверке';
  if (status === 'rejected') return 'отклонено';
  return 'принято';
}

type PendingUpload = {
  uri: string;
  name: string;
  contentType: string;
  intentRequestId: string | null;
  submitRequestId: string;
  existingEvidence?: PaymentEvidence;
};

export function PaymentEvidenceSheet({ visible, userId, projectId, payment, onClose, onChanged }: {
  visible: boolean;
  userId: string;
  projectId: string;
  payment: Payment | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<PaymentEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const mutationRef = useRef(false);

  const load = useCallback(async () => {
    if (!visible || !payment) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listPaymentEvidence(userId, projectId, payment.id));
    } catch (cause) {
      reportError('payment.evidence.list', cause, { projectId, paymentId: payment.id });
      setError(apiErrorMessage(cause, 'Не удалось проверить состояние подтверждения.'));
    } finally {
      setLoading(false);
    }
  }, [visible, payment?.id, userId, projectId]);

  useEffect(() => {
    mutationRef.current = false;
    setMutating(false);
    setPendingUpload(null);
    if (visible) void load();
  }, [visible, payment?.id, load]);

  if (!visible || !payment) return null;
  const latest = rows[0] ?? null;
  const paymentAllowsEvidence = payment.status === 'pending' || payment.status === 'paid_unverified';
  const canUpload = paymentAllowsEvidence
    && (!latest || latest.status === 'rejected' || latest.status === 'upload_pending');
  const status = latest ? evidenceStatus(latest) : null;

  const chooseFile = async () => {
    if (mutationRef.current) return;
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const recovery = latest?.status === 'upload_pending' ? latest : null;
      const contentType = asset.mimeType || '';
      const assetName = asset.name || recovery?.original_filename || `payment-proof-${Date.now()}`;
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(contentType)) {
        setError('Разрешены только JPEG, PNG или PDF.');
        return;
      }
      if (recovery && contentType !== recovery.declared_content_type) {
        setError(`Для продолжения выберите исходный файл «${recovery.original_filename}» того же формата.`);
        return;
      }
      if (recovery && assetName !== recovery.original_filename) {
        setError(`Есть незавершённая загрузка файла «${recovery.original_filename}». Выберите этот же файл и повторите отправку.`);
        return;
      }
      setPendingUpload({
        uri: asset.uri,
        name: assetName,
        contentType,
        intentRequestId: recovery ? null : requestId('payment-evidence-intent'),
        submitRequestId: requestId('payment-evidence-submit'),
        existingEvidence: recovery || undefined,
      });
    } catch (cause) {
      reportError('payment.evidence.pick', cause, { projectId, paymentId: payment.id });
      setError('Не удалось открыть выбранный файл.');
    }
  };

  const upload = async () => {
    if (!pendingUpload || mutationRef.current) return;
    mutationRef.current = true;
    setMutating(true);
    setError(null);
    try {
      let evidenceId: string;
      if (pendingUpload.existingEvidence) {
        await api.resumePaymentEvidenceUpload(
          userId,
          projectId,
          payment.id,
          pendingUpload.existingEvidence,
          pendingUpload.uri,
        );
        evidenceId = pendingUpload.existingEvidence.id;
      } else {
        const intent = await api.createPaymentEvidenceUploadIntent(userId, projectId, payment.id, {
          client_request_id: pendingUpload.intentRequestId as string,
          original_filename: pendingUpload.name,
          content_type: pendingUpload.contentType,
        });
        await api.uploadPaymentEvidenceBytes(userId, intent, pendingUpload.uri);
        evidenceId = intent.id;
      }
      const submitted = await api.submitPaymentEvidence(
        userId,
        projectId,
        payment.id,
        evidenceId,
        { client_request_id: pendingUpload.submitRequestId },
      );
      setRows((current) => [submitted, ...current.filter((row) => row.id !== submitted.id)]);
      setPendingUpload(null);
      onChanged?.();
    } catch (cause) {
      reportError('payment.evidence.upload', cause, { projectId, paymentId: payment.id });
      const retryable = cause instanceof ApiError
        && (cause.status === 0 || cause.status >= 500 || cause.code === 'evidence_object_missing');
      setError(retryable
        ? 'Сервер не подтвердил завершение отправки. Файл сохранён в этом окне — повторите отправку, чтобы продолжить тот же запрос без дубликата.'
        : apiErrorMessage(cause, 'Не удалось отправить подтверждение.'));
    } finally {
      mutationRef.current = false;
      setMutating(false);
    }
  };

  const chooseButtonTitle = latest?.status === 'upload_pending'
    ? 'Продолжить загрузку'
    : latest?.status === 'rejected'
      ? 'Загрузить новую версию'
      : 'Выбрать файл';

  return (
    <SheetSurface
      visible
      title="Подтверждение перевода"
      subtitle={`${payment.title} · ${formatRub(payment.amount)}`}
      busy={mutating}
      onClose={() => { if (!mutationRef.current) onClose(); }}
      accessibilityLabel="Подтверждение ручного перевода"
      footer={<>
        {canUpload && !pendingUpload ? (
          <PrimaryButton
            title={chooseButtonTitle}
            onPress={() => { void chooseFile(); }}
            disabled={mutating}
            fullWidth
          />
        ) : null}
        {pendingUpload ? (
          <PrimaryButton
            title="Отправить на проверку"
            onPress={() => { void upload(); }}
            loading={mutating}
            fullWidth
          />
        ) : null}
        {pendingUpload ? (
          <PrimaryButton
            title="Выбрать другой файл"
            variant="outline"
            onPress={() => { setPendingUpload(null); void chooseFile(); }}
            disabled={mutating}
            fullWidth
          />
        ) : null}
        <PrimaryButton
          title="Обновить статус"
          variant="outline"
          onPress={() => { void load(); }}
          disabled={loading || mutating}
          fullWidth
        />
        <PrimaryButton
          title="Закрыть"
          variant="ghost"
          onPress={() => { if (!mutationRef.current) onClose(); }}
          disabled={mutating}
          fullWidth
        />
      </>}
    >
      <View style={sheetContentStyles.section}>
        <InfoBanner
          tone="info"
          title="Когда оплата считается подтверждённой"
          message="После отправки файла перевод получает статус «оплачено, не верифицировано». В подтверждённый расход сумма войдёт только после проверки."
        />
        {loading ? <Text style={formMetaText.caption}>Проверяем актуальный статус…</Text> : null}
        {error ? <InfoBanner tone="warning" title="Нужна повторная попытка" message={error} /> : null}
        {status ? <InfoBanner tone={status.tone} title={status.title} message={status.message} /> : null}
        {!loading && !latest ? <Text style={formMetaText.caption}>Подтверждение ещё не загружено.</Text> : null}
        {pendingUpload ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Выбран файл</Text>
            <Text style={styles.fileName}>{pendingUpload.name}</Text>
            <Text style={formMetaText.caption}>
              При сбое сети повторите отправку: Renova продолжит тот же запрос и не создаст дубликат.
            </Text>
          </View>
        ) : null}
        {rows.length > 1 ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>История версий</Text>
            {rows.slice(1).map((row) => (
              <View key={row.id} style={styles.historyRow}>
                <Text style={styles.historyTitle}>Версия {row.version} · {evidenceStatusLabel(row.status)}</Text>
                {row.status === 'rejected' ? (
                  <Text style={formMetaText.caption}>{row.rejection_reason || 'Причина не указана'}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </SheetSurface>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.lg,
    padding: RenovaTheme.spacing.md,
    gap: RenovaTheme.spacing.xs,
  },
  sectionTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.body,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  fileName: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.bodySmall,
    fontWeight: RenovaTheme.fontWeight.medium,
  },
  historyRow: {
    gap: RenovaTheme.spacing.xxs,
    paddingTop: RenovaTheme.spacing.xs,
  },
  historyTitle: {
    color: RenovaTheme.colors.text,
    fontSize: RenovaTheme.fontSize.bodySmall,
    fontWeight: RenovaTheme.fontWeight.medium,
  },
});