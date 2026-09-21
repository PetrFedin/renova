"""Ссылки в уведомлениях должны вести туда, где есть экран.

Сервер клал в `return_to` и `link_path` путь `/(role)/(tabs)/home` — 45 раз в
24 файлах. Такого маршрута в приложении нет: главная живёт по корню группы
вкладок, файла `home.tsx` в `apps/mobile/app/(role)/(tabs)/` не существует.

Проверено на живом приложении: адрес `/home` открывает «Такого экрана нет».
Значит кнопка «Назад» после перехода из любого такого уведомления упиралась в
тупик, а часть ссылок вела туда сразу.
"""
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "app"
MOBILE_TABS = Path(__file__).resolve().parents[2] / "apps" / "mobile" / "app"


def _sources() -> list[Path]:
    return sorted(BACKEND.rglob("*.py"))


def test_no_link_points_at_the_missing_home_route():
    offenders: list[str] = []
    for path in _sources():
        text = path.read_text(encoding="utf-8")
        if "(tabs)/home" in text:
            offenders.append(str(path.relative_to(BACKEND)))
    assert offenders == [], f"ссылки на несуществующую главную: {offenders}"


def test_the_route_really_is_missing():
    # Если файл появится, проверку выше нужно пересмотреть, а не удалять.
    for role in ("(customer)", "(contractor)"):
        assert not (MOBILE_TABS / role / "(tabs)" / "home.tsx").exists()
        assert (MOBILE_TABS / role / "(tabs)" / "index.tsx").exists()


def test_links_use_the_group_root():
    # Замена не «убрала» ссылки, а направила их на корень группы вкладок.
    found = 0
    for path in _sources():
        text = path.read_text(encoding="utf-8")
        found += text.count('"/(customer)/(tabs)/"') + text.count('"/(contractor)/(tabs)/"')
    assert found >= 40, f"ссылок на главную осталось подозрительно мало: {found}"
