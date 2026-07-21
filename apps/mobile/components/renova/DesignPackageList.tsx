import { useCallback, useEffect, useState } from 'react';
import { View, Text, Linking, StyleSheet, Alert } from 'react-native';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { uploadMediaBlob } from '@/lib/mediaUpload';
import { pickDocumentForUpload } from '@/lib/documentUploadPick';
import { designPackageStatusLabel } from '@/constants/labels';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';

type DP = { id: string; title: string; version: number; file_url?: string | null; status: string };

export function DesignPackageList({
  userId,
  projectId,
  role,
  embedded,
}: {
  userId: string;
  projectId: string;
  role: string;
  embedded?: boolean;
}) {
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<DP[]>([]);
  const [uploading, setUploading] = useState(false);
  const load = useCallback(() => {
    api.listDesignPackages(userId, projectId).then(setItems).catch(reportCatch('components.renova.DesignPackageList.1'));
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
  const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';

  const uploadPdf = async () => {
    setUploading(true);
    try {
      const picked = await pickDocumentForUpload();
      if (!picked) return;
      const response = await fetch(picked.uri);
      const blob = await response.blob();
      const key = await uploadMediaBlob(userId, blob, picked.type || 'application/pdf');
      await api.createDesignPackage(userId, projectId, { title: picked.name || 'Дизайн-проект', file_key: key });
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any) });
      load();
    } catch {
      Alert.alert('Загрузка', 'Не удалось загрузить документ');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={embedded ? s.embedded : s.box}>
      {!embedded ? <Text style={s.head}>Дизайн-проект</Text> : null}
      {!items.length ? (
        <View style={s.empty}>
          <Text style={s.emptyT}>Пакетов пока нет</Text>
          <Text style={s.emptyH}>
            {role === 'contractor'
              ? 'Загрузите PDF дизайн-проекта — заказчик согласует перед закупкой материалов.'
              : 'Подрядчик загрузит варианты — вы согласуете здесь.'}
          </Text>
        </View>
      ) : null}
      {items.map((d) => (
        <View key={d.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.n}>v{d.version} · {d.title}</Text>
            <Text style={s.st}>{designPackageStatusLabel(d.status)}</Text>
          </View>
          <View style={s.actions}>
            {d.file_url && (
              <PrimaryButton title="Открыть" variant="outline" compact onPress={() => Linking.openURL(`${BASE}${d.file_url}`)} />
            )}
            {role === 'customer' && d.status === 'pending' && (
              <PrimaryButton title="Согласовать" compact onPress={async () => { await api.approveDesignPackage(userId, projectId, d.id); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any) }); load(); }} />
            )}
            {role === 'contractor' && (d.status === 'draft' || d.status === 'published') && (
              <PrimaryButton title="На соглас." variant="outline" compact onPress={async () => { await api.submitDesignPackage(userId, projectId, d.id); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any) }); load(); }} />
            )}
          </View>
        </View>
      ))}
      {role === 'contractor' && (
        <PrimaryButton title={uploading ? 'Загрузка…' : '+ Новая версия PDF'} variant="outline" disabled={uploading} onPress={uploadPdf} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginVertical: 10 },
  embedded: { gap: 8 },
  head: { fontWeight: '800', marginBottom: 8 },
  empty: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 8,
  },
  emptyT: { fontWeight: '700', fontSize: 14 },
  emptyH: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  row: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  n: { fontWeight: '600' },
  st: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
});
