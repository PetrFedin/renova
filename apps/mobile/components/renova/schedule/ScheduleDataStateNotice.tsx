import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import {
  asyncShowError,
  asyncShowStale,
  type AsyncResource,
} from '@/lib/async/asyncResource';

export type ScheduleDataNoticeItem = {
  key: string;
  label: string;
  resource: AsyncResource<unknown>;
  onRetry: () => void;
};

export function ScheduleDataStateNotice({ items }: { items: ScheduleDataNoticeItem[] }) {
  const visible = items.filter((item) =>
    asyncShowError(item.resource) || asyncShowStale(item.resource),
  );
  if (!visible.length) return null;

  return (
    <View style={s.wrap} accessibilityRole="alert">
      {visible.map((item) => {
        const noData = asyncShowError(item.resource);
        const message = noData
          ? `Не удалось загрузить: ${item.label}`
          : `${item.label}: показаны последние полученные данные`;
        return (
          <View key={item.key} style={s.row}>
            <View style={s.copy}>
              <Text style={s.title}>{message}</Text>
              {item.resource.error?.message ? (
                <Text style={s.message}>{item.resource.error.message}</Text>
              ) : null}
            </View>
            <Pressable
              style={s.retry}
              onPress={item.onRetry}
              accessibilityRole="button"
              accessibilityLabel={`Обновить: ${item.label}`}
            >
              <Text style={s.retryText}>Обновить</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 6,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text },
  message: { marginTop: 2, fontSize: 11, lineHeight: 15, color: RenovaTheme.colors.textMuted },
  retry: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
  },
  retryText: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.accent },
});
