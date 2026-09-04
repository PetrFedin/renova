/** Manual bank-transfer evidence lifecycle inside Budget/Payments. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { InfoBanner } from '@/components/ui/InfoBanner';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { formatRub } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { api, ApiError, type Payment, type PaymentEvidence } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formatPhone';
import { reportError } from '@/lib/reportError';

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function evidenceStatus(row: PaymentEvidence): { title: string; message: string; tone: 'info' | 'warning' | 'success' } {
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
      message: 'Проверка завершена. Статус оплаты обновляется по серверной финансовой истине.',
      tone: 'success',
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
    message: 'Файл ещё не подтверждён сервером. Повторите отправку; оплаченный факт не будет показан раньше времени.',
    tone: 'warning',
  };
}

type PendingUpload = {
  uri: string;
  name: string;
  contentType: string;
  intentRequestId: string;
  submitRequestId: string;
};

export function PaymentEvidenceSheet({
  visible,
  userId,
  projectId,
  payment,
  onClose,
  onChanged,
}: {
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
      const next = await api.listPaymentEvidence(userId, projectId, payment.id);
      setRows(next);
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
  const canUpload = payment.status === 'paid_unverified' && (!latest || latest.status === 'rejected' || latest.status === 'upload_pending');
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
      const contentType = asset.mimeType || '';
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(contentType)) {
        setError('Разрешены только JPEG, PNG или PDF.');
        return;
      }
      setPendingUpload({
        uri: asset.uri,
        name: asset.name || `payment-proof-${Date.now()}`,
        contentType,
        intentRequestId: requestId('payment-evidence-intent'),
        submitRequestId: requestId('payment-evidence-submit'),
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
      const intent = await api.createPaymentEvidenceUploadIntent(userId, projectId, payment.id, {
        client_request_id: pendingUpload.intentRequestId,
        original_filename: pendingUpload.name,
        content_type: pendingUpload.contentType,
      });
      await api.uploadPaymentEvidenceBytes(userId, intent, pendingUpload.uri);
      const submitted = await api.submitPaymentEvidence(userId, projectId, payment.id, intent.id, {
        client_request_id: pendingUpload.submitRequestId,
      });
      setRows((current) => [submitted, ...current.filter((row) => row.id !== submitted.id)]);
      setPendingUpload(null);
      onChanged?.();
    } catch (cause) {
      reportError('payment.evidence.upload', cause, { projectId, paymentId: payment.id });
      const retryable = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === 'evidence_object_missing');
      setError(retryable
        ? 'Отправка не подтверждена сервером. Файл и идентификаторы сохранены в этом окне — повторите отправку, чтобы не создать дубликат.'
        : apiErrorMessage(cause, 'Не удалось отправить подтверждение.'));
    } finally {
      mutationRef.current = false;
      setMutating(false);
    }
  };

  return (
    <SheetSurface
      visible
      title="Подтверждение перевода"
      subtitle={`${payment.title} · ${formatRub(payment.amount)}`}
      busy={mutating}
      onClose={() => { if (!mutationRef.current) onClose(); }}
      accessibilityLabel="Подтверждение ручного перевода"
      footer={(
        <>
          {canUpload && !pendingUpload ? <PrimaryButton title={latest?.status === 'rejected' ? 'Загрузить новую версию' : 'Выбрать файл'} onPress={() => { void chooseFile(); }} disabled={mutating} fullWidth /> : null}
          {pendingUpload ? <PrimaryButton title="Отправить на проверку" onPress={() => { void upload(); }} loading={mutating} fullWidth /> : null}
          {pendingUpload ? <PrimaryButton title="Выбрать другой файл" variant="outline" onPress={() => { setPendingUpload(null); void chooseFile(); }} disabled={mutating} fullWidth /> : null}
          <PrimaryButton title="Обновить статус" variant="outline" onPress={() => { void load(); }} disabled={loading || mutating} fullWidth />
          <PrimaryButton title="Закрыть" variant="ghost" onPress={() => { if (!mutationRef.current) onClose(); }} disabled={mutating} fullWidth />
        </>
      )}
    >
      <View style={sheetContentStyles.section}>
        <InfoBanner
          tone="info"
          title="Финансовая истина"
          message="До одобрения подтверждения оплата остаётся «оплачено, не верифицировано» и не входит в подтверждённый расход."
        />
        {loading ? <Text style={formMetaText.caption}>Проверяем актуальный статус…</Text> : null}
        {error ? <InfoBanner tone="warning" title="Нужна повторная попытка" message={error} /> : null}
        {status ? <InfoBanner tone={status.tone} title={status.title} message={status.message} /> : null}
        {!loading && !latest ? <Text style={formMetaText.caption}>Подтверждение ещё не загружено.</Text> : null}
        {pendingUpload ? (
          <View>
            <Text style={formMetaText.label}>Выбран файл</Text>
            <Text style={formMetaText.caption}>{pendingUpload.name}</Text>
            <Text style={formMetaText.caption}>При сетевой ошибке повторная отправка использует тот же request identity.</Text>
          </View>
        ) : null}
        {rows.length > 1 ? (
          <View>
            <Text style={formMetaText.label}>История версий</Text>
            {rows.slice(1).map((row) => (
              <Text key={row.id} style={formMetaText.caption}>
                v{row.version}: {row.status === 'rejected' ? `отклонено — ${row.rejection_reason || 'причина не указана'}` : row.status}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </SheetSurface>
  );
}
