/** Документы проекта — по разделам + единый индекс Document Center */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api, type ProjectDocument, type ProjectDocumentsResponse } from '@/lib/api';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { pollDocumentSignature } from '@/lib/esignPoll';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';
import {
  documentCenterSubtitle,
  isCanonicalDocument,
} from '@/lib/documentCenterMeta';
import { pickDocumentForUpload, pickImageForDocumentUpload } from '@/lib/documentUploadPick';
import { isOfflineQueued, notifyOfflineBlocked, notifyOfflineQueued } from '@/lib/offlineUi';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';

type DocRow = {
  id: string;
  label: string;
  desc: string;
  format: string;
  previewPath?: string;
  filename?: string;
  run?: () => Promise<void>;
  /** PDF — по нажатию меню: открыть / скачать / поделиться */
  pdf?: boolean;
};

type DocSection = {
  title: string;
  hint?: string;
  rows: DocRow[];
};

function sourceLabel(source: string) {
  switch (source) {
    case 'design': return 'Дизайн';
    case 'receipt': return 'Чек';
    case 'acceptance': return 'Приёмка';
    case 'canonical': return 'Документ';
    case 'export': return 'Экспорт';
    default: return source;
  }
}

function statusLabel(doc: ProjectDocument) {
  if (doc.source === 'receipt') return doc.verified ? 'Проверен' : 'Не проверен';
  if (doc.status === 'ready') return 'Готов';
  if (doc.status === 'verified') return 'Проверен';
  if (doc.status === 'unverified') return 'Не проверен';
  return doc.status || '—';
}

function formatDocMeta(doc: ProjectDocument) {
  const parts = [sourceLabel(doc.source), statusLabel(doc)];
  if (doc.version != null) parts.push(`v${doc.version}`);
  if (doc.amount != null) parts.push(formatRub(doc.amount));
  return documentCenterSubtitle(doc, parts.filter(Boolean) as string[]);
}

function indexedFilename(doc: ProjectDocument) {
  if (doc.kind === 'stage_acceptance_act') return `acceptance-${String(doc.meta?.stage_id || doc.id).slice(0, 8)}.pdf`;
  if (doc.kind.includes('estimate')) return doc.kind.endsWith('xlsx') ? 'estimate.xlsx' : doc.kind.endsWith('csv') ? 'estimate.csv' : 'estimate.pdf';
  if (doc.kind.includes('dossier')) return 'project-dossier.pdf';
  if (doc.kind.includes('project')) return 'project-report.pdf';
  return `${doc.kind || 'document'}.pdf`;
}

export function DocumentsHub({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
  projectName?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [docIndex, setDocIndex] = useState<ProjectDocumentsResponse | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [konturAvailable, setKonturAvailable] = useState(false);

  const pdfPath = (path: string) => path.replace('{id}', projectId);

  useEffect(() => {
    let alive = true;
    setIndexLoading(true);
    api.listProjectDocuments(userId, projectId)
      .then((result) => { if (alive) setDocIndex(result); })
      .catch(() => { if (alive) setDocIndex(null); })
      .finally(() => { if (alive) setIndexLoading(false); });
    api.listEsignProviders(userId)
      .then(({ providers }) => {
        if (!alive) return;
        setKonturAvailable(Boolean(providers.find((p) => p.name === 'kontur')?.available));
      })
      .catch(() => { if (alive) setKonturAvailable(false); });
    return () => { alive = false; };
  }, [userId, projectId]);

  const reloadIndex = () => {
    setIndexLoading(true);
    return api.listProjectDocuments(userId, projectId)
      .then((result) => setDocIndex(result))
      .catch(() => setDocIndex(null))
      .finally(() => setIndexLoading(false));
  };

  const recentDocs = useMemo(() => (docIndex?.items || []).slice(0, 8), [docIndex]);

  const sections: DocSection[] = useMemo(() => {
    const rows = {
      estimatePdf: {
        id: 'estimate',
        label: 'Смета проекта',
        desc: 'План работ и суммы по комнатам',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/estimate.pdf'),
        filename: 'estimate.pdf',
        run: () => api.downloadEstimatePdf(userId, projectId),
      },
      projectPdf: {
        id: 'project',
        label: 'Отчёт по объекту',
        desc: 'Прогресс, сроки и бюджет',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/export.pdf'),
        filename: 'project-report.pdf',
        run: () => api.exportProjectPdf(userId, projectId),
      },
      expensesCsv: {
        id: 'expcsv',
        label: 'Расходы',
        desc: 'План и факт — для учёта и Excel',
        format: 'CSV',
        run: () => api.exportExpensesCsv(userId, projectId),
      },
      onecCsv: {
        id: 'onec',
        label: 'Выгрузка в 1С',
        desc: 'Платежи и доп. работы (CSV ;)',
        format: 'CSV',
        run: () => api.export1cPaymentsCsv(userId, projectId),
      },
      bankCsv: {
        id: 'bank',
        label: 'Реестр для банка',
        desc: 'Оплаты для сверки с выпиской',
        format: 'CSV',
        run: () => api.exportBankRegisterCsv(userId, projectId),
      },
      weeklyDigest: {
        id: 'digest',
        label: 'Недельный дайджест',
        desc: 'Push участникам + KPI PDF',
        format: 'Push',
        run: async () => {
          await api.pushWeeklyDigest(userId, projectId);
          await api.exportKpiWeeklyPdf(userId, projectId);
        },
      },
      warrantyClaim: {
        id: 'warranty',
        label: 'Гарантийное обращение',
        desc: 'Тикет + черновик документа',
        format: 'Заявка',
        run: async () => {
          const res = await api.createWarrantyClaim(userId, projectId, {
            title: 'Гарантийное обращение',
            description: 'Создано из Document Center',
          });
          Alert.alert('Гарантия', `Обращение создано. Документ: ${res.document_id.slice(0, 8)}…`);
        },
      },
      activityPdf: {
        id: 'activity',
        label: 'Архив ремонта',
        desc: 'Журнал событий по объекту',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/activity-dossier.pdf'),
        filename: 'activity.pdf',
        run: () => api.exportActivityDossier(userId, projectId),
      },
      calendarIcs: {
        id: 'ical',
        label: 'Календарь работ',
        desc: 'Даты этапов для календаря телефона',
        format: 'ICS',
        run: () => api.exportIcal(userId, projectId),
      },
      estimateTable: {
        id: 'estimate-table',
        label: 'Смета для Excel',
        desc: 'Выберите формат CSV или XLSX',
        format: 'CSV / Excel',
      },
      dossierPdf: {
        id: 'dossier',
        label: 'Полное досье',
        desc: 'Смета, финансы, этапы и архив в одном файле',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/full-dossier.pdf'),
        filename: 'full-dossier.pdf',
        run: () => api.exportFullDossier(userId, projectId),
      },
      gdpr: {
        id: 'gdpr',
        label: 'Мои данные',
        desc: 'Экспорт профиля и списка проектов',
        format: 'JSON',
        run: async () => {
          const data = await api.exportMyData(userId);
          await exportGdprJsonFile(data, 'renova-export.json');
        },
      },
    } satisfies Record<string, DocRow>;

    return [
      {
        title: 'Главное',
        hint: 'То, что чаще всего нужно заказчику',
        rows: [rows.estimatePdf, rows.projectPdf, rows.expensesCsv],
      },
      {
        title: 'Учёт RU',
        hint: '1С, банк, дайджест и гарантия',
        rows: [rows.onecCsv, rows.bankCsv, rows.weeklyDigest, rows.warrantyClaim],
      },
      {
        title: 'Архив и сроки',
        rows: [rows.activityPdf, rows.calendarIcs],
      },
      {
        title: 'Таблицы',
        rows: [rows.estimateTable],
      },
      {
        title: 'Дополнительно',
        rows: [rows.dossierPdf, rows.gdpr],
      },
    ];
  }, [userId, projectId]);

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Документы');
        return;
      }
      const msg = apiErrorMessage(e, '');
      const providerDown =
        (e instanceof ApiError && e.status === 501) ||
        msg.includes('501') ||
        msg.includes('provider_unavailable');
      Alert.alert(
        'Ошибка',
        providerDown
          ? 'Провайдер подписи пока недоступен. Используйте «Подписать в приложении» или повторите позже.'
          : (msg.slice(0, 180) || 'Не удалось выполнить действие. Проверьте связь с API.'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf(row: DocRow) {
    if (!row.previewPath || !row.filename) return;
    const blob = await fetchPdfBlob(userId, row.previewPath);
    await openPdfBlob(blob, row.filename, 'share');
  }

  function openPdfMenu(row: DocRow) {
    if (!row.run) return;
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      {
        text: 'Открыть',
        onPress: () => {
          if (!row.previewPath || !row.filename) return;
          withBusy(`${row.id}-open`, () => previewProjectPdf(userId, row.previewPath!, row.filename!));
        },
      },
      {
        text: 'Скачать',
        onPress: () => withBusy(`${row.id}-dl`, row.run!),
      },
    ];
    if (Platform.OS !== 'web') {
      actions.push({
        text: 'Поделиться',
        onPress: () => withBusy(`${row.id}-share`, () => sharePdf(row)),
      });
    }
    actions.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(row.label, row.desc, actions);
  }

  function openEstimateTableMenu() {
    Alert.alert('Смета для Excel', 'Выберите формат файла', [
      { text: 'CSV', onPress: () => withBusy('csv', () => api.exportEstimateCsv(userId, projectId)) },
      { text: 'Excel (XLSX)', onPress: () => withBusy('xlsx', () => api.exportEstimateXlsx(userId, projectId)) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }

  function onRowPress(row: DocRow) {
    if (row.id === 'estimate-table') {
      openEstimateTableMenu();
      return;
    }
    if (row.pdf) {
      openPdfMenu(row);
      return;
    }
    if (row.run) withBusy(row.id, row.run);
  }

  function openIndexedDocument(doc: ProjectDocument) {
    const openFile = () => {
      if (!doc.href) {
        Alert.alert(
          doc.title,
          'Файл ещё не загружен. Добавьте документ через «+ Файл» или дождитесь генерации акта.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Загрузить', onPress: () => { void uploadCanonicalDocument(); } },
          ],
        );
        return;
      }
      if (doc.href.toLowerCase().includes('.pdf') || doc.href.includes('/media/')) {
        withBusy(`index-${doc.id}`, () => previewProjectPdf(userId, doc.href!, indexedFilename(doc)));
        return;
      }
      Alert.alert(doc.title, `${formatDocMeta(doc)}\n\nФайл доступен в разделе проекта.`);
    };

    if (!isCanonicalDocument(doc)) {
      openFile();
      return;
    }

    // Wave 3d: действия Document Center для канонических документов
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      { text: 'Открыть', onPress: openFile },
      {
        text: 'Подписать в приложении',
        onPress: () => withBusy(`sign-${doc.id}`, async () => {
          await api.signProjectDocument(userId, projectId, doc.id, { provider: 'in_app' });
          await reloadIndex();
          Alert.alert('Подписано', 'Подпись in_app сохранена.');
        }),
      },
      ...(konturAvailable ? [{
        text: 'Подписать через Контур',
        onPress: () => withBusy(`sign-kontur-${doc.id}`, async () => {
          await api.signProjectDocument(userId, projectId, doc.id, { provider: 'kontur' });
          const status = await pollDocumentSignature(userId, projectId, doc.id, { provider: 'kontur' });
          await reloadIndex();
          if (status === 'signed') {
            Alert.alert('Контур', 'Документ подписан.');
          } else if (status === 'failed') {
            Alert.alert('Контур', 'Подпись не завершена. Проверьте статус позже.');
          } else {
            Alert.alert(
              'Контур',
              'Запрос создан (pending). Статус обновится по webhook или при следующем открытии документов.',
            );
          }
        }),
      }] : []),
      {
        text: 'Распознать тип (OCR)',
        onPress: () => withBusy(`ocr-${doc.id}`, async () => {
          await api.runDocumentOcr(userId, projectId, doc.id, true);
          await reloadIndex();
          Alert.alert('OCR', 'Классификация обновлена.');
        }),
      },
      {
        text: doc.meta?.legal_hold ? 'Снять legal hold' : 'Legal hold',
        onPress: () => withBusy(`hold-${doc.id}`, async () => {
          await api.setDocumentLegalHold(userId, projectId, doc.id, !doc.meta?.legal_hold);
          await reloadIndex();
        }),
      },
      {
        text: 'Архив',
        onPress: () => withBusy(`arch-${doc.id}`, async () => {
          await api.archiveProjectDocument(userId, projectId, doc.id);
          await reloadIndex();
        }),
      },
      { text: 'Отмена', style: 'cancel' },
    ];
    Alert.alert(doc.title, formatDocMeta(doc), actions);
  }

  async function doUploadPicked(file: { uri: string; name: string; type: string }) {
    await withBusy('upload', async () => {
      await api.uploadProjectDocument(
        userId,
        projectId,
        file,
        { title: file.name, document_type: 'upload' },
      );
      await reloadIndex();
    });
  }

  /** Wave 3e: web file input + native DocumentPicker / photo fallback */
  async function uploadCanonicalDocument() {
    try {
      if (Platform.OS === 'web') {
        const file = await pickDocumentForUpload();
        if (!file) return;
        await doUploadPicked(file);
        return;
      }

      Alert.alert('Загрузить документ', 'Выберите источник файла', [
        {
          text: 'Файл (PDF, DOC…)',
          onPress: () => {
            void (async () => {
              try {
                const file = await pickDocumentForUpload();
                if (!file) return;
                await doUploadPicked(file);
              } catch (e: any) {
                Alert.alert('Ошибка загрузки', String(e?.message || e));
              }
            })();
          },
        },
        {
          text: 'Фото из галереи',
          onPress: () => {
            void (async () => {
              try {
                const file = await pickImageForDocumentUpload();
                if (!file) return;
                await doUploadPicked(file);
              } catch (e: any) {
                Alert.alert('Ошибка загрузки', String(e?.message || e));
              }
            })();
          },
        },
        { text: 'Отмена', style: 'cancel' },
      ]);
    } catch (e: any) {
      Alert.alert('Ошибка загрузки', String(e?.message || e));
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.sub}>Нажмите на документ — откроется меню или сразу загрузка</Text>
      <OfflineSyncStatus compact />

      <View style={s.indexCard}>
        <View style={s.indexHeader}>
          <View>
            <Text style={s.indexTitle}>Единый индекс</Text>
            <Text style={s.indexHint}>Дизайн, чеки, акты, OCR и подпись — в одном месте</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            {indexLoading ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : null}
            <Pressable
              onPress={() => { void uploadCanonicalDocument(); }}
              disabled={Boolean(busy)}
              style={s.uploadBtn}
              accessibilityRole="button"
              accessibilityLabel="Загрузить документ"
            >
              <Text style={s.uploadBtnText}>{busy === 'upload' ? '…' : '+ Файл'}</Text>
            </Pressable>
          </View>
        </View>
        {docIndex ? (
          <View style={s.countsRow}>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.design}</Text><Text style={s.countLabel}>дизайн</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.acceptances ?? 0}</Text><Text style={s.countLabel}>акты</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.receipts}</Text><Text style={s.countLabel}>чеки</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.exports}</Text><Text style={s.countLabel}>экспорт</Text></View>
          </View>
        ) : (
          <Text style={s.indexEmpty}>Индекс пока недоступен. Базовые документы ниже остаются рабочими.</Text>
        )}
        {recentDocs.length ? (
          <View style={s.recentList}>
            {recentDocs.map((doc) => {
              const loading = busy === `index-${doc.id}`;
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [s.recentRow, pressed && s.rowPressed]}
                  onPress={() => openIndexedDocument(doc)}
                  disabled={Boolean(busy)}
                  accessibilityRole="button"
                  accessibilityLabel={`${doc.title}. ${formatDocMeta(doc)}`}
                >
                  <View style={s.recentMain}>
                    <Text style={s.recentTitle} numberOfLines={1}>{doc.title}</Text>
                    <Text style={s.recentMeta} numberOfLines={1}>{formatDocMeta(doc)}</Text>
                  </View>
                  {loading ? (
                    <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                  ) : (
                    <Ionicons
                      name={doc.href ? 'chevron-forward' : 'information-circle-outline'}
                      size={18}
                      color={RenovaTheme.colors.textMuted}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {sections.map((section) => (
        <View key={section.title} style={s.section}>
          <Text style={s.sectionTitle}>{section.title}</Text>
          {section.hint ? <Text style={s.sectionHint}>{section.hint}</Text> : null}
          {section.rows.map((row) => {
            const loading = busy === row.id || busy?.startsWith(`${row.id}-`);
            return (
              <Pressable
                key={row.id}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
                onPress={() => onRowPress(row)}
                disabled={!!busy}
                accessibilityRole="button"
              >
                <View style={s.rowMain}>
                  <Text style={s.label}>{row.label}</Text>
                  <Text style={s.desc}>{row.desc}</Text>
                </View>
                <View style={s.rowTail}>
                  <Text style={s.format}>{row.format}</Text>
                  {loading ? (
                    <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.textMuted} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 24 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 16, lineHeight: 18 },
  indexCard: { ...card, marginBottom: 18, gap: 10 },
  indexHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  indexTitle: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  uploadBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: RenovaTheme.colors.primary },
  uploadBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  indexHint: { marginTop: 3, fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  indexEmpty: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countPill: { flexGrow: 1, minWidth: '22%', borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 12, paddingVertical: 8, alignItems: 'center', backgroundColor: RenovaTheme.colors.surface },
  countValue: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  countLabel: { fontSize: 10, color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginTop: 2 },
  recentList: { gap: 6 },
  recentRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, paddingTop: 10, paddingBottom: 4 },
  recentMain: { flex: 1, minWidth: 0 },
  recentTitle: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  recentMeta: { marginTop: 2, fontSize: 11, color: RenovaTheme.colors.textMuted },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  sectionHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
  row: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 10,
  },
  rowPressed: { opacity: 0.92, backgroundColor: '#F8FAFC' },
  rowMain: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 3, lineHeight: 16 },
  rowTail: { alignItems: 'flex-end', gap: 4, minWidth: 56 },
  format: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.primary, textTransform: 'uppercase' },
});
