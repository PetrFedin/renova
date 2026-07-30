"""PDF helpers with verified font coverage and readable glyph fallbacks."""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

_FONTS_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"
_FONT_CANDIDATES = [_FONTS_DIR / "DejaVuSans.ttf", _FONTS_DIR / "ArialUnicode.ttf"]
_COVERAGE_PROBES = "АяЁё₽•—№×"

_TRANSLIT: dict[str, str] = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "Yo", "Ж": "Zh", "З": "Z",
    "И": "I", "Й": "Y", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R",
    "С": "S", "Т": "T", "У": "U", "Ф": "F", "Х": "Kh", "Ц": "Ts", "Ч": "Ch", "Ш": "Sh", "Щ": "Shch",
    "Ъ": "", "Ы": "Y", "Ь": "", "Э": "E", "Ю": "Yu", "Я": "Ya",
}

_READABLE_FALLBACKS: dict[str, str] = {
    "₽": "руб.",
    "•": "-",
    "—": "-",
    "–": "-",
    "·": ".",
    "×": "x",
    "№": "No.",
    "…": "...",
    "→": "->",
    "←": "<-",
    "✓": "[x]",
    "✕": "[x]",
}


@lru_cache(maxsize=8)
def _font_codepoints(path: str) -> frozenset[int]:
    """Read the font cmap once. An unreadable font is treated as unavailable."""
    try:
        from fontTools.ttLib import TTFont

        font = TTFont(path, lazy=True)
        try:
            codepoints: set[int] = set()
            for table in font["cmap"].tables:
                codepoints.update(table.cmap.keys())
            return frozenset(codepoints)
        finally:
            font.close()
    except Exception:
        return frozenset()


def _font_score(path: Path) -> tuple[int, int]:
    coverage = _font_codepoints(str(path))
    return (
        sum(ord(char) in coverage for char in _COVERAGE_PROBES),
        len(coverage),
    )


_AVAILABLE_FONTS = [path for path in _FONT_CANDIDATES if path.is_file()]
_FONT_PATH = max(_AVAILABLE_FONTS, key=_font_score) if _AVAILABLE_FONTS else None
_FONT_CODEPOINTS = _font_codepoints(str(_FONT_PATH)) if _FONT_PATH else frozenset()
_USE_UNICODE = bool(_FONT_PATH and _FONT_CODEPOINTS)


def _unicode_safe_char(char: str) -> str:
    if char in "\n\r\t" or ord(char) < 128 or ord(char) in _FONT_CODEPOINTS:
        return char
    replacement = _READABLE_FALLBACKS.get(char)
    if replacement is not None:
        return replacement
    return _TRANSLIT.get(char, "?")


def pdf_safe(text: str | None) -> str:
    """Return text that the selected PDF font can render without missing glyphs."""
    if not text:
        return ""
    value = str(text)
    if _USE_UNICODE:
        return "".join(_unicode_safe_char(char) for char in value)
    return "".join(
        _READABLE_FALLBACKS.get(char, _TRANSLIT.get(char, char if ord(char) < 128 else "?"))
        for char in value
    )


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
    return Response(
        buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
