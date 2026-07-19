"""1С XML escape smoke."""
from app.services.integrations.onec_export import _xml_escape


def test_xml_escape():
    assert _xml_escape('a<b>&"c') == 'a&lt;b&gt;&amp;&quot;c'
