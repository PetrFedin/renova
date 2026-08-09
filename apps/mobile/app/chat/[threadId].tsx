/** Экран чата — подтверждает project/thread ACL до монтирования ChatThreadView */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { ChatThreadView } from '@/components/renova/chat/ChatThreadView';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { reportError } from '@/lib/reportError';
import { resolveChatProjectId } from '@/lib/chatProjectResolution';

type ResolutionState = 'loading' | 'ready' | 'not_found' | 'error';

export default function ChatThreadScreen() {
  const { threadId, projectId, returnTo, highlightId } = useLocalSearchParams<{
    threadId: string;
    projectId?: string;
    returnTo?: string;
    highlightId?: string;
  }>();
  const { loading: sessionLoading, user, activeProject } = useRenova();
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(null);
  const [resolutionState, setResolutionState] = useState<ResolutionState>('loading');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!threadId) {
      setResolvedProjectId(null);
      setResolutionState('not_found');
      return () => { cancelled = true; };
    }
    if (sessionLoading) return () => { cancelled = true; };
    if (!user) {
      setResolvedProjectId(null);
      setResolutionState('error');
      return () => { cancelled = true; };
    }

    setResolvedProjectId(null);
    setResolutionState('loading');
    const candidateProjectId = projectId ?? activeProject?.id ?? null;

    void resolveChatProjectId({
      api,
      userId: user.id,
      threadId,
      candidateProjectId,
    })
      .then((resolved) => {
        if (cancelled) return;
        setResolvedProjectId(resolved);
        setResolutionState(resolved ? 'ready' : 'not_found');
      })
      .catch((error) => {
        if (cancelled) return;
        reportError('chat.route.resolveProject', error, {
          threadId,
          candidateProjectId,
        });
        setResolvedProjectId(null);
        setResolutionState('error');
      });

    return () => { cancelled = true; };
    // activeProject is intentionally a candidate snapshot. Once a thread is resolved,
    // ChatThreadView may load that project into context; that must not restart resolution.
  }, [threadId, projectId, user?.id, sessionLoading, retryNonce]);

  if (!threadId) {
    return <ResolutionMessage returnTo={returnTo} message="Тред не выбран" />;
  }

  if (resolutionState === 'ready' && resolvedProjectId && user) {
    return (
      <ChatThreadView
        key={`${threadId}:${resolvedProjectId}`}
        threadId={threadId}
        projectId={resolvedProjectId}
        returnTo={returnTo}
        highlightId={highlightId}
      />
    );
  }

  if (resolutionState === 'not_found') {
    return (
      <ResolutionMessage
        returnTo={returnTo}
        message="Чат не найден или больше не доступен в ваших объектах."
        retry={() => setRetryNonce((value) => value + 1)}
      />
    );
  }

  if (resolutionState === 'error') {
    return (
      <ResolutionMessage
        returnTo={returnTo}
        message={user
          ? 'Не удалось проверить доступ к чату. Проверьте связь и повторите.'
          : 'Сессия недоступна. Вернитесь назад и войдите снова.'}
        retry={user ? () => setRetryNonce((value) => value + 1) : undefined}
      />
    );
  }

  return <ResolutionMessage returnTo={returnTo} message="Проверяем доступ к чату…" />;
}

function ResolutionMessage({
  returnTo,
  message,
  retry,
}: {
  returnTo?: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <>
      <BackHeader title="Чат" returnTo={returnTo} />
      <View style={s.center}>
        <Text style={s.msg}>{message}</Text>
        {retry ? <PrimaryButton title="Повторить" compact onPress={retry} /> : null}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  msg: { fontSize: 15, color: '#64748B', textAlign: 'center' },
});
