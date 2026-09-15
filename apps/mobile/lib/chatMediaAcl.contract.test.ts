import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const root = join(mobile, '../..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const mutation = read('backend/app/services/chat_message_mutation.py');
const mediaAcl = read('backend/app/services/chat_media_acl.py');
const mediaApi = read('backend/app/api/v1/media.py');
const thread = read('apps/mobile/components/renova/chat/ChatThreadView.tsx');

must(
  mutation.includes('folder=f"chat-media/{thread_id}"')
    && !mutation.includes('folder="chat"'),
  'production chat message writer must create thread-scoped media keys',
);
must(
  mediaAcl.includes('chat_acl.require_chat_access(')
    && mediaAcl.includes('allow_participant=True')
    && mediaAcl.includes('ChatMessage.storage_key == key')
    && mediaAcl.includes('if len(thread_ids) != 1:'),
  'chat media ACL must reuse canonical chat authority and fail closed for ambiguous legacy keys',
);
must(
  mediaApi.includes('parse_chat_media_key(key)')
    && mediaApi.includes('assert_chat_media_access(db, user, key)')
    && mediaApi.includes('is_legacy_chat_media_key(key)')
    && mediaApi.includes('assert_legacy_chat_media_access(db, user, key)'),
  'generic media read/presign must dispatch canonical and legacy chat keys through chat ACL',
);
must(
  thread.includes("import { authHeaders } from '@/lib/api/client';")
    && thread.includes('headers: authHeaders(userId)')
    && thread.includes('userId={user.id}'),
  'chat attachment rendering must authenticate media reads',
);

console.log('chatMediaAcl.contract.test OK');
