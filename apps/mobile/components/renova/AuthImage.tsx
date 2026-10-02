/** Изображение из приватного хранилища (`/api/v1/media/...`): грузим с Authorization (OBJ-16). */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { API_BASE, authHeaders } from '@/lib/api/client';
import { resolveChatMediaRequest } from '@/lib/chatMedia';
import { reportError } from '@/lib/reportError';

type Status = 'loading' | 'ready' | 'error';

export function AuthImage({
  uri,
  userId,
  style,
  resizeMode = 'contain',
  errorLabel = 'Не удалось загрузить изображение',
}: {
  uri: string;
  userId: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'contain' | 'cover';
  errorLabel?: string;
}) {
  const request = resolveChatMediaRequest(uri, API_BASE);
  const isWeb = Platform.OS === 'web';
  const [status, setStatus] = useState<Status>('loading');
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus('loading');
    setSrc(null);
    // На native `Image` сам ходит с заголовками; у web-`<img>` заголовков нет — blob через fetch.
    if (!isWeb) return undefined;
    if (!request.authorized) {
      setSrc(request.uri);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const r = await fetch(request.uri, { headers: authHeaders(userId) });
        if (!r.ok) throw new Error(`media_http_${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (error) {
        if (cancelled) return;
        reportError('authImage.load', error, { uri: request.uri });
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request.uri, request.authorized, userId, attempt, isWeb]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (status === 'error') {
    return (
      <View style={[s.box, style as object]}>
        <Text style={s.errText}>{errorLabel}</Text>
        <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Повторить загрузку изображения" hitSlop={8}>
          <Text style={s.retry}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  const source = isWeb
    ? src ? { uri: src } : null
    : { uri: request.uri, headers: request.authorized ? authHeaders(userId) : undefined };

  return (
    <View style={style as object}>
      {source ? (
        <Image
          key={`${request.uri}:${attempt}`}
          source={source}
          style={style}
          resizeMode={resizeMode}
          onLoad={() => setStatus('ready')}
          onError={() => {
            reportError('authImage.render', new Error('auth_image_render_failed'), { uri: request.uri });
            setStatus('error');
          }}
        />
      ) : null}
      {status === 'loading' ? (
        <View style={[s.overlay, { pointerEvents: 'none' }]}>
          <ActivityIndicator color={RenovaTheme.colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: RenovaTheme.colors.border },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  errText: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center', paddingHorizontal: 8 },
  retry: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.accent, paddingVertical: 8 },
});
