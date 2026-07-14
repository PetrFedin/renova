/** Документы проекта — по разделам + единый индекс Document Center */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api, type ProjectDocument, type ProjectDocumentsResponse } from '@/lib/api';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';

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
  return parts.filter(Boolean).join(' · ');
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

  const pdfPath = (path: string) => path.replace('{id}', projectId);

  useEffect(() => {
    let alive = true;
    setIndexLoading(true);
    api.listProjectDocuments(userId, projectId)
      .then((result) => { if (alive) setDocIndex(result); })
      .catch(() => { if (alive) setDocIndex(null); })
      .finally(() => { if (alive) setIndexLoading(false); });
    return () => { alive = false; };
  }, [userId, projectId]);

  const recentDocs = useMemo(() => (docIndex?.items || []).slice(0, 6), [docIndex]);

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
    } catch {
      Alert.alert('Ошибка', 'Не удалось получить документ. Проверьте подключение к серверу.');
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
    if (!doc.href) {
      const details = [
        formatDocMeta(doc),
        doc.meta?.category ? `Категория: ${doc.meta.category}` : null,
        doc.meta?.comment ? `Комментарий: ${doc.meta.comment}` : null,
      ].filter(Boolean).join('\n');
      Alert.alert(doc.title, details || 'Для этого элемента хранится запись без отдельного файла.');
      return;
    }

    if (doc.href.toLowerCase().includes('.pdf')) {
      withBusy(`index-${doc.id}`, () => previewProjectPdf(userId, doc.href!, indexedFilename(doc)));
      return;
    }

    Alert.alert(
      doc.title,
      `${formatDocMeta(doc)}\n\nФайл этого типа доступен в соответствующем разделе проекта.`,
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.sub}>Нажмите на документ — откроется меню или сразу загрузка</Text>

      <View style={s.indexCard}>
        <View style={s.indexHeader}>
          <View>
            <Text style={s.indexTitle}>Единый индекс</Text>
            <Text style={s.indexHint}>Дизайн, чеки, акты и экспортные документы в одном месте</Text>
          </View>
          {indexLoading ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : null}
        </View>
        {docIndex ? (
          <View style={s.countsRow}>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.design}</Text><Text style={s.countLabel}>дизайн</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.acceptances}</Text><Text style={s.countLabel}>акты</Text></View>
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
