/** Вложение-изображение чата: приватный URL, грузим с Authorization (COM-003). */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { API_BASE, authHeaders } from '@/lib/api/client';
import { resolveChatMediaRequest } from '@/lib/chatMedia';
import { reportError } from '@/lib/reportError';

type Status = 'loading' | 'ready' | 'error';

export function ChatImage({ uri, userId }: { uri: string; userId: string }) {
  const request = resolveChatMediaRequest(uri, API_BASE);
  const [status, setStatus] = useState<Status>('loading');
  const [src, setSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    setStatus('loading');
    setSrc(null);
    // На native `Image` сам ходит по адресу с заголовками (см. ниже); на web заголовки
    // у <img> не поддерживаются — тянем blob через fetch с Authorization.
    if (!isWeb || !request.authorized) {
      if (isWeb) {
        setSrc(request.uri);
      }
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const r = await fetch(request.uri, { headers: authHeaders(userId) });
        if (!r.ok) throw new Error(`chat_media_http_${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (error) {
        if (cancelled) return;
        reportError('chat.image.load', error, { uri: request.uri });
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
      <View style={s.box}>
        <Text style={s.errText}>Не удалось загрузить изображение</Text>
        <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Повторить загрузку изображения" hitSlop={8}>
          <Text style={s.retry}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  const source = isWeb
    ? src
      ? { uri: src }
      : null
    : { uri: request.uri, headers: request.authorized ? authHeaders(userId) : undefined };

  return (
    <View style={s.box}>
      {source ? (
        <Image
          key={`${request.uri}:${attempt}`}
          source={source}
          style={s.img}
          accessibilityLabel="Вложение чата"
          onLoad={() => setStatus('ready')}
          onError={() => {
            reportError('chat.image.render', new Error('chat_image_render_failed'), { uri: request.uri });
            setStatus('error');
          }}
        />
      ) : null}
      {status === 'loading' ? (
        <View style={s.overlay} pointerEvents="none">
          <ActivityIndicator color={RenovaTheme.colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: 200, minHeight: 140, marginTop: 6, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  img: { width: 200, height: 140 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  errText: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center', paddingHorizontal: 8 },
  retry: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.accent, paddingVertical: 8 },
});
