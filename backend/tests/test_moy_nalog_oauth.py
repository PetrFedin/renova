"""Moy nalog OAuth scaffold honesty."""
from app.services import moy_nalog_oauth as oauth


def test_state_roundtrip():
    st = oauth.create_oauth_state("user-1")
    assert oauth.consume_oauth_state(st, "user-1") is True
    assert oauth.consume_oauth_state(st, "user-1") is False  # single use


def test_state_wrong_user():
    st = oauth.create_oauth_state("user-1")
    assert oauth.consume_oauth_state(st, "user-2") is False


def test_build_authorize_url_without_client():
    # default settings: no client id
    assert oauth.build_authorize_url("abc") is None or oauth.oauth_ready() is False
