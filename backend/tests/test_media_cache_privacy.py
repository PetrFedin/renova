"""Private project media must never be stored in a shared cache.

`GET /api/v1/media/{key}` serves stage photos, quality-control defect shots,
floor plans and receipt scans. The `photos/*` branch returned

    Cache-Control: public, max-age=86400, s-maxage=604800

`public` with an `s-maxage` is an explicit invitation to every shared cache in
the path — CDN, corporate proxy, ISP cache — to keep one customer's renovation
photos for a week and serve them to anyone who requests the same URL. That is
the wrong default for content whose only authorisation is possession of the
URL.

This does not close the underlying gap. `photos/{uuid}.jpg` carries no project,
so `media.get_media` cannot apply a project ACL to it the way it does for
`documents/{project_id}/...`, and the mobile client loads these through
`<Image source={{ uri }}>` with no headers, so requiring auth would break every
photo in the app. Fixing it properly needs a project-scoped key scheme,
expiring signatures and a migration for already-stored URLs — issue #449.
"""
from __future__ import annotations

import inspect

from app.api.v1 import media
from app.services.document_media_acl import parse_document_media_key


def _code_only(function) -> str:
    """Source with comment lines dropped.

    The module documents the defect it fixed, so a naive grep would match the
    explanation rather than the behaviour.
    """
    return "\n".join(
        line
        for line in inspect.getsource(function).splitlines()
        if not line.lstrip().startswith("#")
    )


def test_no_media_response_is_publicly_cacheable():
    code = _code_only(media.get_media)

    assert "public, max-age" not in code
    assert "s-maxage" not in code, (
        "s-maxage lets a shared cache retain private project media"
    )


def test_every_media_branch_is_private():
    code = _code_only(media.get_media)

    # Both the redirect branch and the inline-bytes branch.
    assert code.count("private, max-age") >= 2


def test_documents_keep_the_shorter_private_window():
    code = _code_only(media.get_media)

    assert '"private, max-age=3600" if key.startswith("documents/")' in code


def test_document_keys_are_still_acl_checked():
    """The ACL that does exist must not regress while tightening caching."""
    source = inspect.getsource(media.get_media)

    assert "parse_document_media_key(key)" in source
    assert "assert_document_media_access(db, user, key, write=False)" in source


def test_presign_route_also_acl_checks_documents():
    source = inspect.getsource(media.presign_media)

    assert "parse_document_media_key(key)" in source
    assert "assert_document_media_access(db, user, key, write=False)" in source


def test_document_key_parser_still_recognises_project_scoped_keys():
    assert parse_document_media_key("documents/project-1/file.pdf") is not None
    # A photo key carries no project, which is exactly why it cannot be
    # ACL-checked today.
    assert parse_document_media_key("photos/deadbeef.jpg") is None
