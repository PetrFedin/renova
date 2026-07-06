/** Локальная генерация QR без внешних API */
import { useEffect, useState } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import QRCode from 'qrcode';

export function QrCodeImage({ value, size = 200 }: { value: string; size?: number }) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setUri(null);
      return;
    }
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((data) => setUri(data))
      .catch(() => setUri(null));
  }, [value, size]);

  if (!uri) return null;
  return (
    <View style={s.wrap}>
      <Image source={{ uri }} style={{ width: size, height: size }} accessibilityLabel="QR-код" />
    </View>
  );
}

const s = StyleSheet.create({ wrap: { alignItems: 'center', marginVertical: 12 } });
