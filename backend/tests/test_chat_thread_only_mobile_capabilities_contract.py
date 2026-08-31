from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_chat_detail_models_server_authoritative_capabilities():
    source = (
        _repo_root() / "apps/mobile/lib/api/types/chat.ts"
    ).read_text(encoding="utf-8")

    assert "export type ChatCapabilities" in source
    assert "access_scope: 'project' | 'thread'" in source
    assert "can_view_project_actions: boolean" in source
    assert "can_manage_participants: boolean" in source
    assert "can_create_task: boolean" in source
    assert "can_create_invoice: boolean" in source
    assert "capabilities?: ChatCapabilities" in source


def test_thread_only_chat_keeps_composer_but_hides_project_authority_dead_ends():
    source = (
        _repo_root() / "apps/mobile/components/renova/chat/ChatThreadView.tsx"
    ).read_text(encoding="utf-8")

    # Missing/old capabilities fail closed: only an explicit server project
    # scope enables project-authority controls. Core chat write stays outside
    # that gate and therefore remains usable for an exact-thread participant.
    assert "const hasProjectScope = chat?.capabilities?.access_scope === 'project';" in source
    assert "const canManageParticipants = hasProjectScope && chat?.capabilities?.can_manage_participants === true;" in source
    assert "const canCreateTask = hasProjectScope && chat?.capabilities?.can_create_task === true;" in source
    assert "const canCreateInvoice = hasProjectScope && chat?.capabilities?.can_create_invoice === true;" in source
    assert "<View style={s.composer}>" in source
    assert "await api.sendChatMessage(user.id, projectId, threadId" in source

    # Load exact-thread chat first. A thread-only actor must not probe the
    # forbidden project endpoint just to render or reconcile the chat.
    load_block = source.split("const loadMessages = useCallback", 1)[1].split(
        "const markThreadRead = useCallback", 1
    )[0]
    assert load_block.index("await api.getChat") < load_block.index("await loadProject")
    assert "detail.capabilities?.access_scope === 'project'" in load_block

    reconcile_block = source.split("const reconcileCommittedChatMutation", 1)[1].split(
        "const sendText", 1
    )[0]
    assert "await refreshChatAfterCommit(action);" in reconcile_block
    assert "if (hasProjectScope) await refreshProjectAfterCommit(action);" in reconcile_block

    # Project/member/task/finance and project-write-only message actions are
    # hidden instead of being rendered as guaranteed 403 dead ends. Message
    # pin/confirm require the same authoritative project-write capability as
    # participant management, not merely project-read scope.
    assert "{canManageParticipants && (" in source
    assert "onTask={canCreateTask ? () => setTaskMsg(m) : undefined}" in source
    assert "{canCreateInvoice && (" in source
    assert "onPay={canViewProjectActions && m.message_type === 'payment'" in source
    assert "onPin={canManageParticipants ? async () =>" in source
    assert "onConfirm={canManageParticipants && m.message_type === 'confirm'" in source
    assert "onPin={hasProjectScope ? async () =>" not in source
    assert "onConfirm={hasProjectScope && m.message_type === 'confirm'" not in source
    assert "visible={canManageParticipants && inviteOpen}" in source
    assert "visible={canCreateTask && !!taskMsg}" in source
