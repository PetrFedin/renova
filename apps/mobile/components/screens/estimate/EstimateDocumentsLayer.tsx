/** Слой «Документы» — PDF / Excel / CSV сметы + переход в полный раздел документов */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { documentsHref } from '@/lib/documentsNav';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { pushOsNav } from '@/lib/pushOsNav';

type DocRow = {
  id: string;
  label: string;
  desc: string;
  format: string;
  pdf?: boolean;
  previewPath?: string;
  filename?: string;
  run: () => Promise<void>;
};

export function EstimateDocumentsLayer({
  userId,
  projectId,
  pathname,
}: {
  userId: string;
  projectId: string;
  pathname: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('name,line_type,unit,quantity_planned,unit_price,room_name\nШтукатурка стен,work,м2,40,450,Гостиная\n');

  const pdfPath = `/api/v1/projects/${projectId}/estimate.pdf`;

  const rows: DocRow[] = [
    {
      id: 'estimate-pdf',
      label: 'Смета проекта',
      desc: 'План работ и суммы по комнатам',
      format: 'PDF',
      pdf: true,
      previewPath: pdfPath,
      filename: 'estimate.pdf',
      run: () => api.downloadEstimatePdf(userId, projectId),
    },
    {
      id: 'estimate-csv',
      label: 'Смета для Excel (CSV)',
      desc: 'Таблица позиций для учёта',
      format: 'CSV',
      run: () => api.exportEstimateCsv(userId, projectId),
    },
    {
      id: 'estimate-xlsx',
      label: 'Смета для Excel (XLSX)',
      desc: 'Таблица с форматированием',
      format: 'XLSX',
      run: () => api.exportEstimateXlsx(userId, projectId),
    },
  ];

  async function submitImport() {
    setBusy('import-csv');
    try {
      const res = await api.importEstimateCsv(userId, projectId, csvText);
      setImportOpen(false);
      Alert.alert(
        'Импорт сметы',
        `Добавлено: ${res.created}. Пропущено: ${res.skipped}.` +
          (res.errors?.length ? `\nОшибки: ${res.errors.join('; ')}` : ''),
      );
    } catch {
      Alert.alert('Импорт', 'Не удалось импортировать CSV. Проверьте формат и что смета не зафиксирована.');
    } finally {
      setBusy(null);
    }
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch {
      Alert.alert('Ошибка', 'Не удалось получить документ. Проверьте подключение и повторите.');
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
      { text: 'Скачать', onPress: () => withBusy(`${row.id}-dl`, row.run) },
    ];
    if (Platform.OS !== 'web') {
      actions.push({ text: 'Поделиться', onPress: () => withBusy(`${row.id}-share`, () => sharePdf(row)) });
    }
    actions.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(row.label, row.desc, actions);
  }

  function onRowPress(row: DocRow) {
    if (row.pdf) {
      openPdfMenu(row);
      return;
    }
    withBusy(row.id, row.run);
  }

  return (
    <View style={s.wrap}>
      <Text style={s.intro}>
        Экспорт и импорт сметы (CSV из Excel). Полное досье, 1С, банк, гарантия — в «Документы».
      </Text>

      {rows.map((row) => {
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

      <PrimaryButton
        title="Импорт CSV в смету"
        variant="outline"
        onPress={() => setImportOpen(true)}
        disabled={!!busy}
      />

      <PrimaryButton
        title="→ Все документы проекта"
        variant="outline"
        onPress={() => pushOsNav(documentsHref(pathname), pathname)}
      />

      <Modal visible={importOpen} animationType="slide" transparent onRequestClose={() => setImportOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.label}>Импорт сметы (CSV)</Text>
            <Text style={s.desc}>
              Колонки: name, line_type (work|material), unit, quantity_planned, unit_price, room_name
            </Text>
            <ScrollView style={{ maxHeight: 220, marginTop: 8 }}>
              <TextInput
                style={s.csvInput}
                multiline
                value={csvText}
                onChangeText={setCsvText}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => setImportOpen(false)} style={s.modalBtnGhost}>
                <Text style={s.desc}>Отмена</Text>
              </Pressable>
              <Pressable onPress={submitImport} style={s.modalBtn} disabled={busy === 'import-csv'}>
                <Text style={s.modalBtnText}>{busy === 'import-csv' ? '…' : 'Импортировать'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 12, gap: 4 },
  intro: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 8 },
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
