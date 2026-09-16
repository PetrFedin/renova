"""Replay-safe StageComment and StagePhoto creation.

Comments are one DB entity plus one ClientWriteRequest. Photos accept either an
already-uploaded private storage key or inline base64. Inline bytes are written
to a deterministic key before the DB transaction; replay repairs that same key
instead of allocating another blob.
"""
from __future__ import annotations

import hashlib
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import Stage, StageComment, StagePhoto, User
from app.services import storage_service as storage_svc
from app.services.client_write_idempotency import (
    IdempotencyConflict,
    commit_client_write,
    replay_entity_id,
)
from app.services.document_upload_storage import delete_key_best_effort

router = APIRouter(prefix="/projects", tags=["stages"])
STAGE_COMMENT_CREATE_SCOPE = "stage_comment.create"
STAGE_PHOTO_CREATE_SCOPE = "stage_photo.create"


class StageCommentCreateCommand(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


class StagePhotoCreateCommand(BaseModel):
    image_data: str | None = None
    storage_key: str | None = None
    caption: str | None = Field(default=None, max_length=255)
    client_request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")

    @model_validator(mode="after")
    def require_exact_source(self):
        has_inline = bool((self.image_data or "").strip())
        has_key = bool((self.storage_key or "").strip())
        if has_inline == has_key:
            raise ValueError("stage_photo_exactly_one_source_required")
        return self


def _conflict(kind: str) -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": f"Этот запрос {kind} уже использован с другими данными",
        },
    )


async def _stage(db: AsyncSession, *, project_id: str, stage_id: str) -> Stage:
    stage = await db.get(Stage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Этап не найден")
    return stage


def _comment_out(comment: StageComment, *, replayed: bool) -> dict:
    return {
        "id": comment.id,
        "text": comment.text,
        "author_role": comment.author_role,
        "created_at": comment.created_at.isoformat(),
        "replayed": replayed,
    }


def _photo_out(photo: StagePhoto, *, replayed: bool) -> dict:
    return {
        "id": photo.id,
        "caption": photo.caption,
        "created_at": photo.created_at.isoformat(),
        "storage_key": photo.storage_key,
        "replayed": replayed,
    }


def _photo_url(key: str) -> str:
    normalized = storage_svc.normalize_storage_key(key)
    return f"{settings.public_base_url.rstrip('/')}/api/v1/media/{quote(normalized, safe='/')}"


def _deterministic_inline_key(
    *,
    project_id: str,
    stage_id: str,
    user_id: str,
    request_id: str,
    checksum: str,
    extension: str,
) -> str:
    return storage_svc.normalize_storage_key(
        f"stages/{project_id}/{stage_id}/{user_id}/{request_id}_{checksum[:16]}.{extension}"
    )


async def _assert_attachable_key(db: AsyncSession, *, project_id: str, key: str) -> bytes:
    normalized = storage_svc.normalize_storage_key(key)
    if not normalized.startswith(("photos/", "stages/")):
        raise HTTPException(422, "stage_photo_storage_key_invalid")

    # A physical key may belong to only one attached project. The same request
    # replay is handled before this path, so an existing foreign attachment is
    # never re-bound to another project.
    existing_project_id = await db.scalar(
        select(Stage.project_id)
        .join(StagePhoto, StagePhoto.stage_id == Stage.id)
        .where(StagePhoto.storage_key == normalized)
        .limit(1)
    )
    if existing_project_id and existing_project_id != project_id:
        raise HTTPException(409, "stage_photo_storage_key_already_attached")

    data = await storage_svc.read_bytes(normalized)
    if not data:
        raise HTTPException(409, detail={"code": "stage_photo_blob_missing"})
    return data


@router.post("/{project_id}/stages/{stage_id}/comments")
async def create_stage_comment_integrity(
    project_id: str,
    stage_id: str,
    body: StageCommentCreateCommand,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    await _stage(db, project_id=project_id, stage_id=stage_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "stage_comment_text_required")
    payload = {"stage_id": stage_id, "text": text}

    try:
        replay_id = await replay_entity_id(
            db,
            scope=STAGE_COMMENT_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _conflict("комментария") from exc

    if replay_id:
        comment = await db.get(StageComment, replay_id)
        if not comment or comment.stage_id != stage_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _comment_out(comment, replayed=True)

    comment = StageComment(
        stage_id=stage_id,
        user_id=user.id,
        author_role=user.role.value,
        text=text,
    )
    db.add(comment)
    await db.flush()
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=STAGE_COMMENT_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=comment.id,
        )
    except IdempotencyConflict as exc:
        raise _conflict("комментария") from exc

    if not created:
        canonical = await db.get(StageComment, entity_id)
        if not canonical or canonical.stage_id != stage_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _comment_out(canonical, replayed=True)

    await db.refresh(comment)
    return _comment_out(comment, replayed=False)


@router.post("/{project_id}/stages/{stage_id}/photos")
async def create_stage_photo_integrity(
    project_id: str,
    stage_id: str,
    body: StagePhotoCreateCommand,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    await _stage(db, project_id=project_id, stage_id=stage_id)

    wrote_inline = False
    inline_bytes: bytes | None = None
    inline_content_type: str | None = None
    storage_key: str

    if body.storage_key:
        storage_key = storage_svc.normalize_storage_key(body.storage_key)
        source_bytes = await _assert_attachable_key(db, project_id=project_id, key=storage_key)
        checksum = hashlib.sha256(source_bytes).hexdigest()
        payload = {
            "stage_id": stage_id,
            "caption": body.caption,
            "source": "storage",
            "storage_key": storage_key,
            "checksum_sha256": checksum,
        }
    else:
        try:
            inline_bytes, extension, inline_content_type = storage_svc._decode_image(body.image_data or "")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        checksum = hashlib.sha256(inline_bytes).hexdigest()
        storage_key = _deterministic_inline_key(
            project_id=project_id,
            stage_id=stage_id,
            user_id=user.id,
            request_id=body.client_request_id,
            checksum=checksum,
            extension=extension,
        )
        payload = {
            "stage_id": stage_id,
            "caption": body.caption,
            "source": "inline",
            "checksum_sha256": checksum,
        }

    try:
        replay_id = await replay_entity_id(
            db,
            scope=STAGE_PHOTO_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _conflict("фото") from exc

    if replay_id:
        photo = await db.get(StagePhoto, replay_id)
        if not photo or photo.stage_id != stage_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        if inline_bytes is not None:
            existing = await storage_svc.read_bytes(photo.storage_key or "") if photo.storage_key else None
            if not existing or hashlib.sha256(existing).hexdigest() != checksum:
                await storage_svc.write_bytes_at_key(
                    photo.storage_key or storage_key,
                    inline_bytes,
                    content_type=inline_content_type or "image/jpeg",
                )
        else:
            await _assert_attachable_key(db, project_id=project_id, key=photo.storage_key or storage_key)
        return _photo_out(photo, replayed=True)

    if inline_bytes is not None:
        await storage_svc.write_bytes_at_key(
            storage_key,
            inline_bytes,
            content_type=inline_content_type or "image/jpeg",
        )
        wrote_inline = True

    photo = StagePhoto(
        stage_id=stage_id,
        user_id=user.id,
        caption=body.caption,
        storage_key=storage_key,
        image_url=_photo_url(storage_key),
        image_data=None,
    )
    db.add(photo)
    try:
        await db.flush()
    except BaseException:
        await db.rollback()
        if wrote_inline:
            await delete_key_best_effort(storage_key)
        raise

    try:
        created, entity_id = await commit_client_write(
            db,
            scope=STAGE_PHOTO_CREATE_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=photo.id,
        )
    except IdempotencyConflict as exc:
        if wrote_inline:
            await delete_key_best_effort(storage_key)
        raise _conflict("фото") from exc

    if not created:
        canonical = await db.get(StagePhoto, entity_id)
        if not canonical or canonical.stage_id != stage_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        if inline_bytes is not None and canonical.storage_key:
            existing = await storage_svc.read_bytes(canonical.storage_key)
            if not existing or hashlib.sha256(existing).hexdigest() != checksum:
                await storage_svc.write_bytes_at_key(
                    canonical.storage_key,
                    inline_bytes,
                    content_type=inline_content_type or "image/jpeg",
                )
        return _photo_out(canonical, replayed=True)

    await db.refresh(photo)
    return _photo_out(photo, replayed=False)
