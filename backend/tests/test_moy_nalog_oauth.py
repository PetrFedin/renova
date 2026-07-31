"""Moy Nalog OAuth state and configuration integrity."""
import pytest

from app.services import moy_nalog_oauth as oauth


@pytest.mark.asyncio
async def test_state_roundtrip():
    state = await oauth.create_oauth_state("user-1")
    assert await oauth.consume_oauth_state(state, "user-1") is True
    assert await oauth.consume_oauth_state(state, "user-1") is False


@pytest.mark.asyncio
async def test_state_wrong_user():
    state = await oauth.create_oauth_state("user-1")
    assert await oauth.consume_oauth_state(state, "user-2") is False


def test_build_authorize_url_without_client():
    with pytest.raises(oauth.MoyNalogConfigurationError):
        oauth.build_authorize_url("abc")
    assert oauth.oauth_ready() is False
