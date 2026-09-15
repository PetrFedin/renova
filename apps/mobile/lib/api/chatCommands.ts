/** Only server-idempotent chat business commands may use this replay policy. */
import { req } from './client';
import { shouldQueueReplaySafeMutation } from './failurePolicy';
import { createClientRequestId } from '@/lib/clientRequestId';
import type { ChatMessage } from './types';

export type ChatTaskInput = {
  title: string;
  assignee_id?: string;
  due_at?: string;
  work_type?: string;
  client_request_id?: string;
};

export type ChatInvoiceInput = {
  title: string;
  amount: number;
  payment_type?: string;
  client_request_id?: string;
};

/** Compatibility export for existing transport qualification tests. */
export function canQueueChatCommand(error: unknown): boolean {
  return shouldQueueReplaySafeMutation(error);
}

export async function submitChatCommand(
  userId: string, path: string, input: ChatTaskInput | ChatInvoiceInput,
): Promise<ChatMessage> {
  const body = JSON.stringify({
    ...input,
    client_request_id: input.client_request_id ?? createClientRequestId('chat-command'),
  });
  try {
    return await req<ChatMessage>(path, { method: 'POST', body }, userId);
  } catch (error) {
    if (!shouldQueueReplaySafeMutation(error)) throw error;
    const { enqueue } = await import('@/lib/offlineQueue');
    // Preserve the FIRST attempted identity and bytes; never issue a fresh intent
    // merely because transport outcome is unknown. Persistence must succeed.
    await enqueue({ path, method: 'POST', body, userId });
    throw new Error('offline_queued');
  }
}
