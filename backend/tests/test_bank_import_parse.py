"""P4.1b: parse bank CSV smoke."""
from app.services.integrations.bank_import import parse_bank_statement_csv


def test_parse_semicolon_with_header():
    text = "Дата;Сумма;Назначение\n19.07.2026;150000,50;Оплата этапа черновые\n"
    rows = parse_bank_statement_csv(text)
    assert len(rows) == 1
    assert rows[0]["amount"] == 150000.50
    assert rows[0]["date"] == "2026-07-19"
    assert "черновые" in rows[0]["description"]


def test_parse_positional():
    text = "2026-07-01;1000;Test pay\n"
    rows = parse_bank_statement_csv(text)
    assert len(rows) == 1
    assert rows[0]["amount"] == 1000.0
