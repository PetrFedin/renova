"""Акт приёмки печатался по параметру адреса и транслитом.

Чек-лист брался из строки запроса: `?checks=Работы%20выполнены|…` — и
каждая переданная строка печаталась с отметкой «[x] выполнено». На живом
стенде так получили «акт» на этапе, который никто не принимал:

    Priyomka: Подготовка
    Status: active
    Checklist:
    [x] Работы выполнены в полном объёме
    [x] Претензий по качеству нет

Плюс весь документ был набран транслитом («Priyomka», «Oplata»,
«Status»), сырым значением перечисления, и не содержал ни объекта, ни
адреса.
"""

from pathlib import Path

import app.api.v1.export as export


def _handler_source() -> str:
    source = Path(export.__file__).read_text(encoding="utf-8")
    block = source.split("async def export_acceptance")[1].split("\n@router.")[0]
    return "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("#"))


def test_checklist_is_not_taken_from_the_query_string():
    code = _handler_source()
    assert "checks.split(" not in code, "чек-лист снова печатается из параметра адреса"
    assert "[x] {item}" not in code, "строки из запроса снова помечаются выполненными"
    assert "wf.stage_checklist(stage)" in code, "чек-лист не берётся из самого этапа"


def test_done_flag_comes_from_the_item_itself():
    code = _handler_source()
    assert 'item.get("done")' in code, "отметка «выполнено» не читается из пункта"
    assert '"[ ]"' in code, "невыполненный пункт не отличается от выполненного"


def test_unaccepted_stage_says_so():
    code = _handler_source()
    assert "customer_accepted_at is not None" in code
    assert "ЭТАП НЕ ПРИНЯТ" in code, "непринятый этап выдаётся за акт приёмки"
    assert "не является актом приёмки" in code


def test_act_names_the_object():
    code = _handler_source()
    assert "project.name" in code, "в акте нет объекта"
    assert "project.address" in code, "в акте нет адреса объекта"


def test_act_speaks_russian():
    code = _handler_source()
    for translit in ("Priyomka", "Oplata", "Prinyato", "Checklist:", "Photos:"):
        assert translit not in code, f"в акте остался транслит: {translit}"
    assert "STAGE_STATUS_LABEL" in code, "состояние этапа печатается сырым значением"


def test_status_labels_cover_every_stage_status():
    from app.models.entities import StageStatus

    for status in StageStatus:
        assert status.value in export.STAGE_STATUS_LABEL, f"нет подписи для {status.value}"
