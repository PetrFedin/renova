/** Баннер когда API недоступен или сессия без данных — с кнопкой восстановления */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';

type Props = {
  /** Показать даже если API доступен, но нет проектов */
  showEmpty?: boolean;
};

const isDemoEnv = process.env.EXPO_PUBLIC_DEMO === '1' || __DEV__;

export function ApiStatusBanner({ showEmpty }: Props) {
  const { apiReachable, projects, recoverSession, loading } = useRenova();
  const [busy, setBusy] = useState(false);

  const needsRecovery = !apiReachable || (showEmpty && projects.length === 0);
  if (!needsRecovery || loading) return null;

  const title = !apiReachable ? 'Нет связи с сервером' : 'Нет данных проекта';
  const sub = !apiReachable
    ? 'Проверьте интернет и нажмите «Повторить»'
    : isDemoEnv
      ? 'Нажмите «Загрузить демо» для восстановления данных'
      : 'Создайте объект или войдите снова';
  const subtle = apiReachable && projects.length === 0;
  const showDemoBtn = isDemoEnv || !apiReachable;

  return (
    <View style={[s.box, !apiReachable && s.offline, subtle && s.subtle]}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
      ) : showDemoBtn ? (
        <Pressable
          style={s.btn}
          onPress={async () => {
            setBusy(true);
            try {
              await recoverSession();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={s.btnT}>{!apiReachable ? 'Повторить' : 'Демо'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RenovaTheme.colors.warningBg,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.warningBorder,
  },
  subtle: {
    backgroundColor: RenovaTheme.colors.borderLight,
    borderColor: RenovaTheme.colors.border,
  },
  offline: { backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder },
  title: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.text },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  btn: {
    backgroundColor: RenovaTheme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  btnT: { color: RenovaTheme.colors.inverseText, fontWeight: '700', fontSize: 12 },
});
