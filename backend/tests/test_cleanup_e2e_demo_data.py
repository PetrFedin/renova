from scripts.cleanup_e2e_demo_data import is_canonical_project, is_e2e_chat_title, is_e2e_project


def test_canonical_demo_projects_are_never_candidates():
    assert is_canonical_project("Демо-квартира, ул. Пример 12")
    assert not is_e2e_project("Демо-квартира, ул. Пример 12", "E2E")
    assert not is_e2e_project("Демо-дом, дачный посёлок", None)


def test_e2e_projects_detected_by_name_or_address_marker():
    assert is_e2e_project("Room Lifecycle 1790-abc", "E2E")
    assert is_e2e_project("CO Lifecycle 1", None)
    assert is_e2e_project("Контрактный объект 123", "E2E")
    assert is_e2e_project("Материалы объекта 5", "E2E material supply")
    assert not is_e2e_project("Квартира на Ленина", "Москва, Ленина 1")


def test_e2e_chat_titles_exact_markers_only():
    assert is_e2e_chat_title("E2E")
    assert is_e2e_chat_title("UAT checklist")
    assert is_e2e_chat_title("E2E retry thread")
    assert not is_e2e_chat_title("Общий чат объекта")
    assert not is_e2e_chat_title("work:123")
