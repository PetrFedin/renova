import { View, Text, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { t } from '@/lib/i18n';

export function ReadOnlyBanner() {
  const { readOnly } = useRenova();
  if (!readOnly) return null;
  return <View style={s.wrap}><Text style={s.txt}>🔒 {t('readOnly')}</Text></View>;
}
export function useWriteAllowed() {
  const { readOnly } = useRenova();
  return !readOnly;
}
const s = StyleSheet.create({ wrap: { backgroundColor: '#fef3c7', padding: 8, borderRadius: 8, marginBottom: 8 }, txt: { fontWeight: '600', fontSize: 12 } });
