"""Ollama digest fail-open when disabled / unreachable."""
import pytest

from app.services.integrations.ollama_digest import generate_digest_narrative


@pytest.mark.asyncio
async def test_digest_disabled_returns_none(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "ollama_digest_enabled", False)
    out = await generate_digest_narrative("Demo", {"progress_percent": 10})
    assert out is None


@pytest.mark.asyncio
async def test_digest_no_base_url(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "ollama_digest_enabled", True)
    monkeypatch.setattr(config.settings, "ollama_base_url", None)
    out = await generate_digest_narrative("Demo", {"progress_percent": 10})
    assert out is None
