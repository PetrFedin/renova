"""PDF helpers — Unicode TTF (если есть) или транслит."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

_FONTS_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"
_FONT_CANDIDATES = [_FONTS_DIR / "DejaVuSans.ttf", _FONTS_DIR / "ArialUnicode.ttf"]
_FONT_PATH = next((p for p in _FONT_CANDIDATES if p.is_file()), None)
_USE_UNICODE = _FONT_PATH is not None

_TRANSLIT: dict[str, str] = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "Yo", "Ж": "Zh", "З": "Z",
    "И": "I", "Й": "Y", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R",
    "С": "S", "Т": "T", "У": "U", "Ф": "F", "Х": "Kh", "Ц": "Ts", "Ч": "Ch", "Ш": "Sh", "Щ": "Shch",
    "Ъ": "", "Ы": "Y", "Ь": "", "Э": "E", "Ю": "Yu", "Я": "Ya", "₽": "RUB", "—": "-", "·": ".",
}


def pdf_safe(text: str | None) -> str:
    if not text:
        return ""
    if _USE_UNICODE:
        return str(text)
    return "".join(_TRANSLIT.get(ch, ch if ord(ch) < 128 else "?") for ch in str(text))


def _set_font(pdf: FPDF, size: int) -> None:
    if _USE_UNICODE:
        pdf.set_font("Renova", size=size)
    else:
        pdf.set_font("Helvetica", size=size)


def new_pdf() -> FPDF:
    pdf = FPDF()
    pdf.add_page()
    if _USE_UNICODE:
        pdf.add_font("Renova", "", str(_FONT_PATH))
    _set_font(pdf, 14)
    return pdf


def pdf_line(pdf: FPDF, text: str, size: int = 10) -> None:
    _set_font(pdf, size)
    pdf.cell(0, 6 if size <= 10 else 10, pdf_safe(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def pdf_response(pdf: FPDF, filename: str):
    from fastapi.responses import Response

    buf = BytesIO()
    pdf.output(buf)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})
