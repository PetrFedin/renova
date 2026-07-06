import { BackHeader } from '@/components/renova/BackHeader';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';
import { QrCodeImage } from '@/components/renova/QrCodeImage';

export default function TeamQrScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [perm, req] = useCameraPermissions();
  const [link, setLink] = useState('');
  const [scan, setScan] = useState(false);
  useEffect(() => { if (user) api.createTeamInviteLink(user.id).then((l) => setLink(l.link)); }, [user?.id]);
  if (!perm?.granted && scan) return <View style={s.wrap}><PrimaryButton title="Камера" onPress={req} /></View>;
  return (<><BackHeader title="Бригада QR" returnTo={returnTo} />
      <View style={s.wrap}>
    <Text style={s.link}>{link || '…'}</Text>
    {link ? <QrCodeImage value={link} size={200} /> : null}
    <PrimaryButton title={scan ? 'Стоп' : 'Сканировать invite'} onPress={() => setScan(!scan)} />
    {scan && perm?.granted && <CameraView style={s.cam} barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={async ({ data }) => {
        const m = data.match(/join\/([^/?]+)/); if (!m || !user) return;
        await api.joinTeam(user.id, m[1]); Alert.alert('Готово'); router.back();
      }} />}
  </View></>);
}
const s = StyleSheet.create({ wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background }, link: { fontSize: 12, marginBottom: 12 }, cam: { flex: 1, marginTop: 12, borderRadius: 12 } });
