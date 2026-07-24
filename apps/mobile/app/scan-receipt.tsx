import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { resolveStageForRoom } from '@/lib/stageResolve';
import { ManualExpenseForm } from '@/components/renova/ManualExpenseForm';
import { ExpenseContextPickers } from '@/components/renova/ExpenseContextPickers';
import { type ExpenseCategoryId } from '@/constants/expenseCategories';

/** QR чека — на web вставка строки, на iPhone камера */
import { BackHeader } from '@/components/renova/BackHeader';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { paymentReceiptKey } from '@/constants/sessionKeys';
import { alertReceiptScanned } from '@/lib/receiptNav';
import type { OsRole } from '@/constants/osSections';

const REQUIRED_RECEIPT_QR_FIELDS = ['t', 's', 'fn', 'i', 'fp', 'n'] as const;

function isReceiptQr(value: string): boolean {
  const normalized = value.trim().replace(/^\?/, '');
  if (!normalized) return false;

  const params = new URLSearchParams(normalized);
  return REQUIRED_RECEIPT_QR_FIELDS.every((field) => Boolean(params.get(field)?.trim()));
}

export default function ScanReceiptScreen() {
  const { returnTo, roomId: roomParam, stageId: stageParam, paymentId } = useLocalSearchParams<{ returnTo?: string; roomId?: string; stageId?: string; paymentId?: string }>();
  const { user, activeProject, loadProject } = useRenova();
  const [perm, requestPerm] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [roomId, setRoomId] = useState<string | null>(roomParam || null);
  const [stageId, setStageId] = useState<string | null>(stageParam || null);
  const scanned = useRef(false);

  useEffect(() => {
    if (!activeProject?.stages || !roomId || stageId) return;
    const auto = resolveStageForRoom(activeProject.stages, roomId, null);
    if (auto) setStageId(auto);
  }, [activeProject?.stages, roomId, stageId]);

  async function submit(qr: string) {
    if (!user || !activeProject || busy || scanned.current) return;

    const normalizedQr = qr.trim();
    if (!isReceiptQr(normalizedQr)) {
      Alert.alert('Некорректный QR чека', 'Нужна строка ФНС с параметрами t, s, fn, i, fp и n. Отсканируйте QR повторно или вставьте полную строку.');
      return;
    }

    scanned.current = true;
    setBusy(true);
    try {
      const r = await api.scanReceipt(
        user.id,
        activeProject.id,
        normalizedQr,
        category,
        roomId,
        resolveStageForRoom(activeProject.stages, roomId, stageId),
        paymentId ? String(paymentId) : null,
      ) as { verified: boolean; message: string; amount: number; payment_id?: string | null };
      if (paymentId) {
        await AsyncStorage.setItem(paymentReceiptKey(String(paymentId)), '1');
      }
      await loadProject(activeProject.id);
      await syncProjectSideEffects({ user, project: activeProject }); // W94: бюджет/аналитика
      // W129: чек → расходы / материалы / оплаты SoT
      const role = (user.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
      alertReceiptScanned(
        role,
        {
          verified: r.verified,
          message: r.message,
          amount: r.amount,
          paymentId: paymentId ? String(paymentId) : r.payment_id,
        },
        () => router.back(),
      );
    } catch {
      scanned.current = false;
      Alert.alert('Ошибка', 'Не удалось проверить чек. Проверьте QR или сервер.');
    } finally {
      setBusy(false);
    }
  }

  if (Platform.OS === 'web') {
    return (
      <>
        <BackHeader title="Скан чека" returnTo={returnTo} subtitle={paymentId ? 'Чек для подтверждения оплаты счёта' : 'Вставьте строку QR с чека'} />
        <View style={styles.wrap}>
          <Text style={styles.hintWeb}>Формат: t=...&s=...&fn=...&i=...&fp=...&n=1</Text>
          <TextInput
            style={styles.input}
            multiline
            value={manual}
            onChangeText={setManual}
            editable={!busy}
            placeholder="Вставьте строку из QR чека"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {activeProject && (
            <ExpenseContextPickers
              project={activeProject}
              roomId={roomId}
              stageId={stageId}
              category={category}
              onRoomChange={setRoomId}
              onStageChange={setStageId}
              onCategoryChange={setCategory}
              disabled={busy}
            />
          )}
          <PrimaryButton disabled={busy || !manual.trim()} title={busy ? 'Проверка…' : 'Проверить и сохранить'} onPress={() => submit(manual)} />
          {user && activeProject && <ManualExpenseForm userId={user.id} project={activeProject} initialRoomId={roomId} initialStageId={stageId} collapsed onSaved={() => loadProject(activeProject.id)} />}
        </View>
      </>
    );
  }

  if (!perm?.granted) {
    return (
      <>
        <BackHeader title="Скан чека" returnTo={returnTo} subtitle="Для сканирования нужен доступ к камере" />
        <View style={styles.wrap}>
          <PrimaryButton title="Разрешить камеру" onPress={requestPerm} />
        </View>
      </>
    );
  }

  return (
    <>
      <BackHeader title="Скан чека" returnTo={returnTo} subtitle="Камера или расход без чека ниже" />
      {activeProject && (
        <ExpenseContextPickers
          project={activeProject}
          roomId={roomId}
          stageId={stageId}
          category={category}
          onRoomChange={setRoomId}
          onStageChange={setStageId}
          onCategoryChange={setCategory}
          disabled={busy}
        />
      )}
      <View style={{ flex: 1, minHeight: 280 }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => submit(data)}
        />
        <Text style={styles.hint}>Наведите на QR чека</Text>
      </View>
      {user && activeProject && (
        <View style={styles.manualWrap}>
          <ManualExpenseForm userId={user.id} project={activeProject} initialRoomId={roomId} initialStageId={stageId} collapsed onSaved={() => loadProject(activeProject.id)} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  manualWrap: { padding: 16, paddingBottom: 32 },
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 10, padding: 12, minHeight: 100, marginBottom: 16, fontSize: 13 },
  hintWeb: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  hint: { position: 'absolute', bottom: 40, alignSelf: 'center', color: RenovaTheme.colors.surface, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 8 },
});
