/** Баннер восстановления связи; отсутствие проектов в production обрабатывает ProjectEmptyState */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';

type Props = {
  /** В demo/dev разрешить отдельное восстановление seed, если проектов нет */
  showEmpty?: boolean;
};

const isDemoEnv = process.env.EXPO_PUBLIC_DEMO === '1' || __DEV__;

export function ApiStatusBanner({ showEmpty }: Props) {
  const { apiReachable, projects, recoverSession, loading } = useRenova();
  const [busy, setBusy] = useState(false);

  const demoNeedsSeedRecovery = Boolean(showEmpty) && isDemoEnv && projects.length === 0;
  const needsRecovery = !apiReachable || demoNeedsSeedRecovery;
  if (!needsRecovery || loading) return null;

  const title = !apiReachable ? 'Нет связи с сервером' : 'Нет данных демо';
  const sub = !apiReachable
    ? 'Проверьте интернет и нажмите «Повторить»'
    : 'Нажмите «Загрузить демо» для восстановления тестовых данных';
  const subtle = apiReachable && demoNeedsSeedRecovery;

  return (
    <View style={[s.box, !apiReachable && s.offline, subtle && s.subtle]}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
      ) : (
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
          <Text style={s.btnT}>{!apiReachable ? 'Повторить' : 'Загрузить демо'}</Text>
        </Pressable>
      )}
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
