# RENOVA chat attachment media ACL contract

Status: source contract for #453. This change is stacked on the project-media ACL repair (#449 / PR #455) because both dispatch through the generic media endpoint, but chat authority remains a separate domain contract.

## 1. Security boundary

A chat attachment is part of a `ChatMessage`, not a public blob. The authorization chain is:

```text
media key -> ChatMessage / encoded thread -> ChatThread -> require_chat_access(..., allow_participant=True)
```

A user who cannot read the owning thread cannot read or presign its bytes even if the storage key is known.

## 2. Canonical new namespace

New production photo/file messages persist media under:

```text
chat-media/{thread_id}/{opaque_file_name}.{extension}
```

`send_client_message` captures immutable `thread_id` before storage and uses the same id in the storage namespace and `ChatMessage.thread_id`.

The media endpoint parses the thread id from the key, loads that thread, and delegates authority to the existing canonical chat ACL with `allow_participant=True`.

## 3. Authority semantics

This contract mirrors chat visibility; it does not invent a stricter or broader policy.

- project customer / assigned contractor retain the project-scope chat authority already granted by `require_chat_access`;
- an active thread-only invite may read exactly the invited thread;
- the same invited user may not infer/read a sibling thread merely because it belongs to the same renovation project;
- a revoked/non-active thread-only participant loses attachment access because `require_chat_access` re-evaluates participant status on every read/presign;
- unrelated identities receive privacy `404`.

## 4. Legacy `chat/*` compatibility

Legacy attachment keys are not public.

For a `chat/*` key the server searches persisted `ChatMessage.storage_key` references. The key is accepted only when all persisted references resolve to exactly one owning thread. Zero threads or references spanning multiple threads fail closed with privacy `404`.

After resolving the one owning thread, the same current `require_chat_access` check applies. This preserves existing data without making the legacy namespace a possession-based capability.

The legacy demo helper may still materialize `chat/*`; the production client-originated mutation path no longer does.

## 5. Mobile read contract

Chat message `image_url` remains an authenticated RENOVA media route. `ChatThreadView` must send current auth headers when rendering the attachment image. A protected media URL must never be treated as a public browser URL or contain the long-lived JWT in its query string.

If/when file attachments gain a separate open/download CTA, it must use the authenticated download path or a server-issued short-lived capability whose revocation semantics are explicitly defined.

## 6. Recovery / idempotency boundary

This repair does not replace chat message identity. `client_request_id` remains the logical intent identity and `ClientWriteRequest` remains the exactly-once ledger for message creation.

An attachment path is derived inside that message mutation. Retrying the same logical message must resolve to the canonical message through the existing chat atomicity/idempotency contract, not create a second logical message because attachment bytes differ.

Known orphan-candidate cleanup for a losing concurrent storage write remains the separate recovery/retention concern already documented by the chat mutation source; it is not solved by weakening media ACL.

## 7. Verification required

Before #453 can be called qualified, the exact branch head must prove:

- active thread-only participant can access canonical media;
- sibling-thread and unrelated access return privacy 404;
- revoked participant immediately loses canonical and legacy attachment access;
- project customer / assigned contractor remain consistent with canonical chat ACL;
- legacy unreferenced and cross-thread ambiguous keys fail closed;
- production `send_client_message` writes under `chat-media/{thread_id}`;
- mobile rendering sends auth headers;
- existing thread-only ACL, chat message atomicity/idempotency and reconciliation tests remain green.

Until CI passes, status is `SOURCE REPAIRED / CI PENDING`, not `E2E VERIFIED`.
