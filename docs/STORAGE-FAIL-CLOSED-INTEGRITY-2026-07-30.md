# Storage fail-closed integrity — 2026-07-30

## Defects

The media service previously hid storage failures:

- failed S3 writes silently fell back to the local disk;
- the returned URL could still point to S3, producing a broken “successful” upload;
- failed S3 reads silently searched local files;
- partial S3 configuration was treated as local mode;
- local paths accepted untrusted `../` segments;
- base64 images were truncated to a character limit instead of being rejected;
- PNG/WebP payloads were stored with JPEG names and content type;
- boto3 I/O blocked async request handlers;
- CloudFront signing errors fell back to an unsigned URL;
- scheme removal used `str.lstrip`, which can corrupt domains beginning with scheme characters.

## Canonical storage modes

### Intentional local mode

S3 connection fields are absent. Files are written atomically under `UPLOADS_DIR` and returned through `/api/v1/media/{key}`.

### Configured S3 mode

Endpoint, access key, secret key and bucket are complete. Every S3 operation must succeed or raise `StorageUnavailable`. No local fallback is allowed.

### Partial configuration

A partial S3 configuration raises `StorageConfigurationError`. It cannot silently select local mode.

## Safety guarantees

- Storage keys are canonical relative POSIX paths.
- Absolute paths, traversal and NUL bytes are rejected.
- The resolved local path must remain below `UPLOADS_DIR`.
- Local writes use a temporary sibling file followed by atomic `os.replace`.
- URLs are percent encoded without changing path separators.
- Image payloads are validated, size-limited and retain supported MIME/extension.
- S3 reads distinguish a true missing object from service failure.
- Blocking S3 and filesystem I/O runs through `asyncio.to_thread`.
- Configured CloudFront signing never degrades to an unsigned private URL.
- Storage failures map to safe HTTP responses: invalid key `400`, unavailable/configuration error `503`.

## Regression coverage

`backend/tests/test_storage_integrity.py` covers:

- local mode with the default bucket name;
- partial S3 configuration;
- atomic local write/read and local URL truth;
- path traversal and absolute paths;
- invalid and oversized base64;
- PNG MIME/extension preservation;
- S3 write failure without local fallback;
- missing S3 object versus unavailable S3;
- CloudFront domain handling and signed-mode failure;
- global API error mapping.

The test is part of the mandatory backend/E2E CI gate.
