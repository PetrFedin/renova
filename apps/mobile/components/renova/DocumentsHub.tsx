/** Документы проекта — по разделам, одно действие на строку без дубля кнопок */
import { useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';

type DocRow = {
  id: string;
  label: string;
  desc: string;
  format: string;
  previewPath?: string;
  filename?: string;
  run: () => Promise<void>;
  /** PDF — по нажатию меню: открыть / скачать / поделиться */
  pdf?: boolean;
};

type DocSection = {
  title: string;
  hint?: string;
  rows: DocRow[];
};

export function DocumentsHub({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
  projectName?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const pdfPath = (path: string) => path.replace('{id}', projectId);

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
        rows: [
          {
            id: 'estimate-table',
            label: 'Смета для Excel',
            desc: 'Выберите формат CSV или XLSX',
            format: 'CSV / Excel',
            run: async () => {},
          },
        ],
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
        onPress: () => withBusy(`${row.id}-dl`, row.run),
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
    withBusy(row.id, row.run);
  }

  return (
    <View style={s.wrap}>
      <Text style={s.sub}>Нажмите на документ — откроется меню или сразу загрузка</Text>

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
