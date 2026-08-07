/** Слой «Документы» — PDF / Excel / CSV сметы + переход в полный раздел документов */
import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { documentsHref } from '@/lib/documentsNav';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

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
  const { user, activeProject, loadProject } = useRenova();
  const contextRef = useRef({ userId: user?.id ?? null, projectId: activeProject?.id ?? null });
  contextRef.current = { userId: user?.id ?? null, projectId: activeProject?.id ?? null };
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
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
    if (!csvText.trim()) {
      Alert.alert('Импорт', 'Вставьте CSV-данные сметы.');
      return;
    }
    if (busy) return;

    setBusy('import-csv');
    try {
      let result: Awaited<ReturnType<typeof api.importEstimateCsv>>;
      try {
        result = await api.importEstimateCsv(userId, projectId, csvText);
      } catch (error) {
        reportError('components.screens.estimate.EstimateDocumentsLayer.Import', error, { projectId });
        Alert.alert('Импорт', 'Не удалось импортировать CSV. Проверьте формат и что смета не зафиксирована.');
        return;
      }

      // Import is committed. Refreshing the current project is reconciliation,
      // not part of the mutation result: it must never turn a successful import
      // into a false failure message.
      setImportOpen(false);
      let refreshFailed = false;
      if (contextRef.current.userId === userId && contextRef.current.projectId === projectId) {
        try {
          await loadProject(projectId);
        } catch (error) {
          refreshFailed = true;
          reportError('components.screens.estimate.EstimateDocumentsLayer.PostCommitRefresh', error, { projectId });
        }
      } else {
        refreshFailed = true;
        reportError(
          'components.screens.estimate.EstimateDocumentsLayer.ContextChangedAfterCommit',
          new Error('Estimate import committed after active project context changed'),
          { projectId, userId },
        );
      }

      Alert.alert(
        'Импорт сметы',
        `Добавлено: ${result.created}. Пропущено: ${result.skipped}.` +
          (result.delimiter ? ` Разделитель: ${result.delimiter}.` : '') +
          (result.errors?.length ? `\nОшибки строк: ${result.errors.join('; ')}` : '') +
          (refreshFailed ? '\n\nИмпорт сохранён на сервере, но экран не удалось обновить. Повторно откройте объект или обновите данные.' : ''),
      );
    } finally {
      setBusy(null);
    }
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(id);
    try {
      await fn();
    } catch (error) {
      reportError('components.screens.estimate.EstimateDocumentsLayer.DocumentAction', error, { projectId, action: id });
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
    const actions: { label: string; onPress: () => void }[] = [
      {
        label: 'Открыть',
        onPress: () => {
          if (!row.previewPath || !row.filename) return;
          void withBusy(`${row.id}-open`, () => previewProjectPdf(userId, row.previewPath!, row.filename!));
        },
      },
      { label: 'Скачать', onPress: () => { void withBusy(`${row.id}-dl`, row.run); } },
    ];
    if (Platform.OS !== 'web') {
      actions.push({ label: 'Поделиться', onPress: () => { void withBusy(`${row.id}-share`, () => sharePdf(row)); } });
    }
    showActionConfirm({
      title: row.label,
      message: row.desc,
      actions,
    });
  }

  function onRowPress(row: DocRow) {
    if (row.pdf) {
      openPdfMenu(row);
      return;
    }
    void withBusy(row.id, row.run);
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
            style={({ pressed }: { pressed: boolean }) => [s.row, pressed && s.rowPressed]}
            onPress={() => onRowPress(row)}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}, ${row.format}`}
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
        onPress={() => pushOsNav(documentsHref(pathname), pathname, role)}
      />

      <Modal visible={importOpen} animationType="slide" transparent onRequestClose={() => { if (!busy) setImportOpen(false); }}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.label}>Импорт сметы (CSV / Excel / ГрандСмета)</Text>
            <Text style={s.importHint}>
              Заголовки: Наименование; Ед.; Кол-во; Цена (или сумма). Разделитель ; , или tab.
            </Text>
            <Text style={s.desc}>
              Колонки: name, line_type (work|material), unit, quantity_planned, unit_price, room_name
            </Text>
            <ScrollView style={s.csvScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                style={s.csvInput}
                multiline
                value={csvText}
                onChangeText={setCsvText}
                autoCapitalize="none"
                autoCorrect={false}
                editable={busy !== 'import-csv'}
                accessibilityLabel="CSV данные сметы"
              />
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable
                onPress={() => setImportOpen(false)}
                style={s.modalBtnGhost}
                disabled={!!busy}
                accessibilityRole="button"
              >
                <Text style={s.modalBtnGhostText}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={() => { void submitImport(); }}
                style={[s.modalBtn, busy === 'import-csv' && s.modalBtnDisabled]}
                disabled={busy === 'import-csv'}
                accessibilityRole="button"
              >
                {busy === 'import-csv' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={s.modalBtnText}>Импортировать</Text>
                )}
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(15,23,42,0.5)',
  },
  modalCard: {
    ...card,
    padding: 16,
    maxHeight: '88%',
  },
  importHint: { color: RenovaTheme.colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 6, marginBottom: 4 },
  csvScroll: { maxHeight: 240, marginTop: 10 },
  csvInput: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 10,
    padding: 12,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.background,
    fontSize: 12,
    lineHeight: 17,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalBtnGhost: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalBtnGhostText: { color: RenovaTheme.colors.text, fontSize: 14, fontWeight: '700' },
  modalBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: RenovaTheme.colors.primary,
  },
  modalBtnDisabled: { opacity: 0.65 },
  modalBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
