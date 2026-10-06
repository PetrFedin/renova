"""Выход на устройстве обязан обрывать и его access-токен.

`POST /auth/logout` гасил только refresh-сессию. Access-токен оставался
рабочим до конца собственного срока: до 20 минут в staging и production
(`effective_access_expire_minutes` режет их там до 20) и до двух недель
в разработке, где стоит настроенное значение 14 суток. То есть после
«выхода» на чужом или потерянном устройстве аккаунт оставался открытым.

Механизм отзыва в репозитории уже был — `/auth/sessions/revoke-all`
ставит `tokens_invalid_before` и гасит разом все устройства. Для выхода
на одном устройстве он не годится: выход на телефоне выбрасывал бы и
планшет. Поэтому токен привязан к своей сессии через claim `sid`.
"""

import pytest
from fastapi import HTTPException

from app.api.deps import get_current_user
from app.api.v1.auth import logout_session, user_out_with_token
from app.core.security import decode_access_token
from app.models.entities import User, UserRole
from app.schemas.auth import RefreshRequest
from app.services import session_service as sess_svc

pytestmark = pytest.mark.asyncio


async def _user(db, suffix: str) -> User:
    user = User(phone=f"+7999444{suffix}", role=UserRole.customer, full_name="Хозяин")
    db.add(user)
    await db.commit()
    return user


async def test_issued_access_token_carries_its_session(db):
    user = await _user(db, "01")
    out = await user_out_with_token(user, db)

    payload = decode_access_token(out.access_token)
    assert payload["sub"] == user.id
    assert payload.get("sid"), "токен не привязан к сессии — выход его не погасит"

    session = await sess_svc.get_session_by_id(db, payload["sid"]) if hasattr(sess_svc, "get_session_by_id") else None
    if session is not None:
        assert session.user_id == user.id


async def test_logout_closes_the_access_token_of_that_device(db):
    user = await _user(db, "02")
    out = await user_out_with_token(user, db)
    header = f"Bearer {out.access_token}"

    # До выхода токен работает.
    who = await get_current_user(user_id=user.id, authorization=header, db=db)
    assert who.id == user.id

    result = await logout_session(RefreshRequest(refresh_token=out.refresh_token), db=db)
    assert result["revoked"] is True
    assert result["access_invalidated"] is True

    with pytest.raises(HTTPException) as exc:
        await get_current_user(user_id=user.id, authorization=header, db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "session_revoked"


async def test_logout_on_one_device_does_not_touch_another(db):
    user = await _user(db, "03")
    phone = await user_out_with_token(user, db, device_id="phone")
    tablet = await user_out_with_token(user, db, device_id="tablet")

    await logout_session(RefreshRequest(refresh_token=phone.refresh_token), db=db)

    with pytest.raises(HTTPException):
        await get_current_user(user_id=user.id, authorization=f"Bearer {phone.access_token}", db=db)

    still = await get_current_user(user_id=user.id, authorization=f"Bearer {tablet.access_token}", db=db)
    assert still.id == user.id, "выход на телефоне выбросил и планшет"


async def test_token_without_session_claim_keeps_working(db):
    """Токены, выданные до появления `sid`, не должны разлогинить всех на выкатке."""
    from app.core.security import create_access_token

    user = await _user(db, "04")
    legacy = create_access_token(user.id, {"role": "customer"})

    who = await get_current_user(user_id=user.id, authorization=f"Bearer {legacy}", db=db)
    assert who.id == user.id
