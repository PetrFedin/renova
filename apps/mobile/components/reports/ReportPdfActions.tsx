/** Кнопки PDF: открыть · поделиться · скачать */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { downloadReportPdf, previewReportPdf, shareReportPdf, type ReportPdfKind } from '@/lib/reports/reportPdf';
import type { ExpenseCategoryId, FinalReportSectionId } from '@/lib/reports/reportSections';

type Props = {
  userId: string;
  projectId: string;
  kind: ReportPdfKind;
  sections?: FinalReportSectionId[];
  categories?: ExpenseCategoryId[];
  onError?: (e: unknown) => void;
  /** Только если нет user/project — JSON preview error НЕ отключает PDF (отдельный endpoint). */
  disabled?: boolean;
};

export function ReportPdfActions({ userId, projectId, kind, sections, categories, onError, disabled }: Props) {
  const opts = kind === 'final' ? { sections, categories } : undefined;

  async function run(_mode: 'preview' | 'share' | 'download', fn: () => Promise<void>) {
    if (disabled) return;
    try {
      await fn();
    } catch (e) {
      onError?.(e);
    }
  }

  return (
    <View style={[s.row, disabled ? s.rowDisabled : null]}>
      <ActionBtn label="Открыть" icon="👁" disabled={disabled} onPress={() => run('preview', () => previewReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn label="Поделиться" icon="↗" disabled={disabled} onPress={() => run('share', () => shareReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn label="Скачать" icon="↓" disabled={disabled} onPress={() => run('download', () => downloadReportPdf(userId, projectId, kind, opts))} />
    </View>
  );
}

function ActionBtn({ label, icon, onPress, disabled }: { label: string; icon: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      style={[s.btn, disabled ? s.btnDisabled : null]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={s.icon}>{icon}</Text>
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  rowDisabled: { opacity: 0.45 },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  btnDisabled: { opacity: 0.5 },
  icon: { fontSize: 16, marginBottom: 2 },
  label: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
});
