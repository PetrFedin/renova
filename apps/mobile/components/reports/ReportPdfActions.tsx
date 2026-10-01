/** Кнопки PDF: открыть · поделиться · скачать */
import { useState } from 'react';
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
};

export function ReportPdfActions({ userId, projectId, kind, sections, categories, onError }: Props) {
  const opts = kind === 'final' ? { sections, categories } : undefined;

  // INB-36: пока PDF формируется, повторные нажатия не запускают новую генерацию
  const [busy, setBusy] = useState<string | null>(null);

  async function run(mode: 'preview' | 'share' | 'download', fn: () => Promise<void>) {
    if (busy) return;
    setBusy(mode);
    try {
      await fn();
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={s.row}>
      <ActionBtn busy={busy === 'preview'} disabled={Boolean(busy)} label="Открыть" icon="👁" onPress={() => run('preview', () => previewReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn busy={busy === 'share'} disabled={Boolean(busy)} label="Поделиться" icon="↗" onPress={() => run('share', () => shareReportPdf(userId, projectId, kind, opts))} />
      <ActionBtn busy={busy === 'download'} disabled={Boolean(busy)} label="Скачать" icon="↓" onPress={() => run('download', () => downloadReportPdf(userId, projectId, kind, opts))} />
    </View>
  );
}

function ActionBtn({ label, icon, onPress, busy, disabled }: { label: string; icon: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      style={[s.btn, disabled && !busy && s.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={busy ? `${label}: готовим файл` : label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
    >
      <Text style={s.icon}>{busy ? '…' : icon}</Text>
      <Text style={s.label}>{busy ? 'Готовим…' : label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: {
    flex: 1,
    alignItems: 'center',
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
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
