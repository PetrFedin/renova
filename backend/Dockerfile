# syntax=docker/dockerfile:1.7

# Docker Official Image index digest for python:3.12.13-slim-bookworm.
# Updating the base requires an explicit reviewed Dockerfile change.
ARG PYTHON_IMAGE=python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

FROM ${PYTHON_IMAGE} AS builder
ARG POETRY_VERSION=2.4.1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1
WORKDIR /app

RUN python -m pip install "poetry==${POETRY_VERSION}"
COPY backend/pyproject.toml backend/poetry.lock backend/README.md ./
RUN poetry check --lock \
    && poetry sync --only main --no-root --no-interaction --no-ansi \
    && .venv/bin/python -m pip check \
    && .venv/bin/python -m pip uninstall -y pip setuptools wheel \
    && .venv/bin/python -c "import fastapi, starlette, uvicorn, sqlalchemy, redis, multipart, sentry_sdk; from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor; from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter; from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter"

FROM ${PYTHON_IMAGE} AS runtime
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="Renova Backend" \
      org.opencontainers.image.description="Renova production API and background-worker runtime" \
      org.opencontainers.image.source="https://github.com/PetrFedin/renova" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}" \
    RENOVA_GIT_SHA="${VCS_REF}"

WORKDIR /app
RUN rm -rf \
      /usr/local/lib/python3.12/ensurepip \
      /usr/local/lib/python3.12/site-packages/pip \
      /usr/local/lib/python3.12/site-packages/pip-*.dist-info \
      /usr/local/bin/pip \
      /usr/local/bin/pip3 \
      /usr/local/bin/pip3.12 \
    && groupadd --gid 10001 renova \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin renova \
    && mkdir -p /app/uploads \
    && chown 10001:10001 /app/uploads

COPY --from=builder --chown=10001:10001 /app/.venv /app/.venv
COPY --chown=10001:10001 backend/app /app/app
COPY --chown=10001:10001 backend/alembic /app/alembic
COPY --chown=10001:10001 backend/alembic.ini /app/alembic.ini
COPY --chown=10001:10001 backend/pyproject.toml backend/poetry.lock /app/
COPY --chmod=755 backend/docker/renova-api backend/docker/renova-worker /usr/local/bin/

USER 10001:10001
EXPOSE 8100

# One image has two process roles. The API command writes role=api and is
# checked through /ready; the worker command writes role=worker and is checked
# through its fresh local heartbeat. Unknown roles fail closed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["python", "-m", "app.runtime_healthcheck"]

CMD ["renova-api"]
