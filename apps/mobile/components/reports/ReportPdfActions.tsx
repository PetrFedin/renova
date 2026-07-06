/** Кнопки PDF: открыть · поделиться · скачать */
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
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
};

export function ReportPdfActions({ userId, projectId, kind, sections, categories, onError }: Props) {
  const opts = kind === 'final' ? { sections, categories } : undefined;

  async function run(mode: 'preview' | 'share' | 'download', fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      onError?.(e);
    }
  }

  return (
    <View style={s.row}>
      <ActionBtn label="Открыть" icon="👁" onPress={() => run('preview', () => previewReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn label="Поделиться" icon="↗" onPress={() => run('share', () => shareReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn label="Скачать" icon="↓" onPress={() => run('download', () => downloadReportPdf(userId, projectId, kind, opts))} />
    </View>
  );
}

function ActionBtn({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable style={s.btn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={s.icon}>{icon}</Text>
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  icon: { fontSize: 16, marginBottom: 2 },
  label: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
});
