import { Modal, View, Text, StyleSheet } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { RenovaTheme, formatRub } from '@/constants/Theme';

type Props = { visible: boolean; price?: number; onClose: () => void; onUpgrade: () => void };
export function PaywallModal({ visible, price = 990, onClose, onUpgrade }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Нужна подписка Про</Text>
          <Text style={s.body}>Бесплатный тариф — 1 объект. Подключите Про для неограниченных объектов.</Text>
          <PrimaryButton title={`Про ${formatRub(price)}/мес`} onPress={onUpgrade} />
          <PrimaryButton title="Позже" variant="outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  body: { color: RenovaTheme.colors.textMuted, lineHeight: 20 },
});
