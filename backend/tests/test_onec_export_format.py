"""P4.1: CSV format smoke (no DB)."""
import csv
import io


def test_csv_semicolon_and_bom():
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Тип", "Сумма"])
    w.writerow(["payment:stage", "150000.00"])
    text = buf.getvalue()
    assert text.startswith("\ufeff")
    assert ";" in text
    assert "payment:stage" in text
