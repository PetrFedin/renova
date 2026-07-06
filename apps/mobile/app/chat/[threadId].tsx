/** Экран чата — делегирует в ChatThreadView */
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { ChatThreadView } from '@/components/renova/chat/ChatThreadView';

export default function ChatThreadScreen() {
  const { threadId, projectId, returnTo, highlightId } = useLocalSearchParams<{
    threadId: string;
    projectId?: string;
    returnTo?: string;
    highlightId?: string;
  }>();

  if (!threadId) {
    return (
      <>
        <BackHeader title="Чат" returnTo={returnTo} />
        <View style={s.center}>
          <Text style={s.msg}>Тред не выбран</Text>
        </View>
      </>
    );
  }

  return (
    <ChatThreadView
      threadId={threadId}
      projectId={projectId}
      returnTo={returnTo}
      highlightId={highlightId}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { fontSize: 15, color: '#64748B', textAlign: 'center' },
});
