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
import { reportCatch } from '@/lib/reportError';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import type { OsRole } from '@/constants/osSections';
import { tabsRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';

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
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const load = useCallback(() => {
    setLoadState('loading');
    api
      .listDesignPackages(userId, projectId)
      .then((list) => {
        setItems(list);
        setLoadState('loaded');
      })
      .catch((e) => {
        reportCatch('components.renova.DesignPackageList.1')(e);
        setLoadState('error');
      });
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

  if (loadState === 'error') {
    return (
      <View style={embedded ? s.embedded : s.box}>
        <LoadErrorState
          title="Не удалось загрузить дизайн-пакеты"
          onRetry={load}
          role={(role === 'contractor' ? 'contractor' : 'customer') as OsRole}
        />
      </View>
    );
  }

  return (
    <View style={embedded ? s.embedded : s.box}>
      {!embedded ? <Text style={s.head}>Дизайн-проект</Text> : null}
      {!items.length ? (
        <EmptyActionState
          title="Пакетов пока нет"
          hint={
            role === 'contractor'
              ? 'Загрузите PDF дизайн-проекта — заказчик согласует перед закупкой.'
              : 'Подрядчик загрузит варианты — вы согласуете здесь.'
          }
          actionLabel={role === 'contractor' ? '+ Загрузить PDF' : 'Написать в чат'}
          onAction={
            role === 'contractor'
              ? () => { void uploadPdf(); }
              : () => pushOsNav(tabsRoute('customer', 'chat'), undefined, 'customer')
          }
        />
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
              <PrimaryButton
                title="Согласовать"
                compact
                onPress={() => {
                  // Clarity U: design approve — confirm (reject API в mobile пока нет)
                  showActionConfirm({
                    title: 'Согласовать дизайн?',
                    message: `v${d.version} · ${d.title}. После согласия можно закупать по этому пакету.`,
                    primaryLabel: 'Согласовать',
                    onPrimary: () => {
                      void (async () => {
                        try {
                          await api.approveDesignPackage(userId, projectId, d.id);
                          await syncProjectSideEffects({
                            user: user ?? ({ id: userId } as any),
                            project: activeProject ?? ({ id: projectId } as any),
                          });
                          load();
                        } catch (e: unknown) {
                          showActionConfirm({
                            title: 'Не удалось',
                            message: e instanceof Error ? e.message : 'Ошибка согласования',
                          });
                        }
                      })();
                    },
                    secondaryLabel: 'Отмена',
                    onSecondary: () => undefined,
                  });
                }}
              />
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
  head: { ...screenTypography.section, marginTop: 0 },
  empty: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  emptyT: { ...screenTypography.listTitle },
  emptyH: { ...screenTypography.empty, marginTop: 4 },
  row: {
    ...listRowStyles.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  n: { ...screenTypography.listTitle },
  st: { ...screenTypography.listMeta },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
});
