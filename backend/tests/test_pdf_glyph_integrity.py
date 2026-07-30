from __future__ import annotations

import logging
import warnings

from app.services import pdf_helper


def _all_renderable(text: str) -> bool:
    if not pdf_helper._USE_UNICODE:
        return all(ord(char) < 128 or char in "\n\r\t" for char in text)
    return all(
        char in "\n\r\t" or ord(char) < 128 or ord(char) in pdf_helper._FONT_CODEPOINTS
        for char in text
    )


def test_missing_currency_glyph_has_readable_fallback(monkeypatch):
    monkeypatch.setattr(pdf_helper, "_USE_UNICODE", True)
    monkeypatch.setattr(pdf_helper, "_FONT_CODEPOINTS", frozenset(range(128)))

    assert pdf_helper.pdf_safe("ИТОГО 100 ₽") == "ITOGO 100 rub."
    assert pdf_helper.pdf_safe("№1 • 2 × 3 — готово") == "No.1 - 2 x 3 - gotovo"


def test_selected_font_text_contains_only_renderable_codepoints():
    safe = pdf_helper.pdf_safe("Смета: Тест • ИТОГО 100 ₽ №1 × 2 — готово")

    assert _all_renderable(safe)
    assert "₽" in safe or "руб." in safe
    assert "•" in safe or "-" in safe
    assert "×" in safe or "x" in safe


def test_pdf_output_has_no_missing_glyph_warnings(caplog):
    caplog.set_level(logging.WARNING)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        pdf = pdf_helper.new_pdf()
        pdf_helper.pdf_line(pdf, "Смета: Тест", size=14)
        pdf_helper.pdf_line(pdf, "ИТОГО: 100 ₽ • №1 × 2 — готово", size=11)
        payload = bytes(pdf.output())

    assert payload.startswith(b"%PDF-")
    warning_text = "\n".join(str(item.message) for item in caught)
    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "missing glyph" not in warning_text.lower()
    assert "missing glyph" not in log_text.lower()
