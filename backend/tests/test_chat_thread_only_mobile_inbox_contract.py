from pathlib import Path


def test_chat_list_uses_global_inbox_without_project_membership():
    root = Path(__file__).resolve().parents[2]
    source = (
        root / "apps/mobile/components/renova/chat/ChatListView.tsx"
    ).read_text(encoding="utf-8")

    # A phone invite may be the user's only Renova relationship. The list must
    # still load /chats/inbox rather than falling back to a project-scoped API.
    assert "await reloadStore();" in source
    assert "projects.length > 0" not in source.split("const reload = useCallback", 1)[1].split(");\n\n  const threads", 1)[0]
    assert "api.listChats" not in source
    assert "const [localThreads" not in source
    assert "storeThreads.filter" in source

    # Project context switching is best-effort for thread-only ACL; navigation
    # must continue even if loading the containing project is forbidden.
    open_block = source.split("const openThread = async", 1)[1].split("const threadActions", 1)[0]
    assert "loadProject(t.project_id).catch" in open_block
    assert "nav.chat(t.id, t.project_id);" in open_block
