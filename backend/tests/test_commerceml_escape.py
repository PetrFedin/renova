"""CommerceML builder uses xml escape."""
from app.services.integrations.onec_export import _xml_escape


def test_cml_escape():
    assert "&lt;" in _xml_escape("<x>")
