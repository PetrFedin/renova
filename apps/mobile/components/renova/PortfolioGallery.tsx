import { useEffect, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';

export function PortfolioGallery({ userId, profileId }: { userId: string; profileId: string }) {
  const [photos, setPhotos] = useState<{ id: string; image_url: string; caption?: string }[]>([]);
  useEffect(() => { api.contractorPortfolio(userId, profileId).then(setPhotos).catch(() => {}); }, [profileId]);
  if (!photos.length) return null;
  return (
    <View style={s.box}><Text style={s.head}>Портфолио</Text>
      <ScrollView horizontal>{photos.map(p => <Image key={p.id} source={{ uri: `${BASE}${p.image_url}` }} style={s.img} />)}</ScrollView>
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginVertical:8 }, head:{ fontWeight:'700', marginBottom:6 }, img:{ width:100, height:70, borderRadius:8, marginRight:8, backgroundColor:RenovaTheme.colors.border } });
