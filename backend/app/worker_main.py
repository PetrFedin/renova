"""Dedicated Renova background-worker process.

The worker uses the same immutable backend image as the API, but owns durable
background loops so HTTP replicas can scale and fail independently.
"""
from __future__ import annotations

import asyncio
import logging
import signal

from app.core.config import settings
from app.core.logging_config import setup_logging
from app.core.observability import configure_worker_observability
from app.core.rate_limit import rate_limiter
from app.core.runtime_policy import configured_runtime_warnings, validate_configured_runtime
from app.core.timeutil import utc_now
from app.db.session import init_db
from app.services.runtime_topology import (
    WorkerHeartbeatPublisher,
    worker_heartbeat_loop,
)

logger = logging.getLogger("renova.worker")


def _task_names() -> tuple[str, ...]:
    names = ["domain_outbox"]
    if settings.automation_reminders_enabled:
        names.append("automation_reminders")
    if settings.push_receipt_worker_enabled:
        names.append("push_receipt_reconciliation")
    return tuple(names)


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            # add_signal_handler is unavailable on some non-POSIX event loops.
            pass


async def _validate_worker_runtime() -> None:
    policy = validate_configured_runtime()
    for warning in configured_runtime_warnings():
        logger.warning(warning)

    from app.services.document_ocr_runtime import validate_document_ocr_runtime
    from app.services.esign.runtime import validate_esign_runtime
    from app.services.otp_runtime import validate_otp_runtime
    from app.services.storage_runtime import validate_storage_runtime

    validate_esign_runtime()
    validate_document_ocr_runtime()
    await validate_otp_runtime()
    await rate_limiter.ping()
    await init_db()
    validate_storage_runtime()
    logger.info("worker runtime validated (environment=%s)", policy.name)


async def _graceful_stop(tasks: list[asyncio.Task], *, timeout_sec: float = 10.0) -> None:
    if not tasks:
        return
    done, pending = await asyncio.wait(tasks, timeout=timeout_sec)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    for task in done:
        if task.cancelled():
            continue
        try:
            task.result()
        except Exception:
            logger.exception("worker task failed during shutdown", exc_info=True)


async def run_worker() -> int:
    setup_logging()
    await _validate_worker_runtime()
    observability_runtime = configure_worker_observability()

    stop = asyncio.Event()
    _install_signal_handlers(stop)
    active_tasks = _task_names()
    started_at = utc_now().isoformat(timespec="seconds") + "Z"
    publisher = WorkerHeartbeatPublisher()

    # Fail startup if a deployed worker cannot publish the shared heartbeat.
    await publisher.publish(active_tasks=active_tasks, started_at=started_at)

    from app.services.outbox_worker import outbox_worker_loop

    tasks: list[asyncio.Task] = [
        asyncio.create_task(
            outbox_worker_loop(stop, interval_sec=15.0),
            name="renova-worker-domain-outbox",
        )
    ]

    if settings.automation_reminders_enabled:
        from app.services.automation_reminders_worker import automation_reminders_loop

        tasks.append(
            asyncio.create_task(
                automation_reminders_loop(
                    stop,
                    interval_sec=float(settings.automation_reminders_interval_sec),
                ),
                name="renova-worker-automation-reminders",
            )
        )

    if settings.push_receipt_worker_enabled:
        from app.services.push_receipt_worker import push_receipt_worker_loop

        tasks.append(
            asyncio.create_task(
                push_receipt_worker_loop(
                    stop,
                    interval_sec=float(settings.push_receipt_worker_interval_sec),
                ),
                name="renova-worker-push-receipts",
            )
        )

    tasks.append(
        asyncio.create_task(
            worker_heartbeat_loop(
                stop,
                publisher,
                active_tasks=active_tasks,
                started_at=started_at,
            ),
            name="renova-worker-heartbeat",
        )
    )
    logger.info("renova worker started tasks=%s", ",".join(active_tasks))

    stop_waiter = asyncio.create_task(stop.wait(), name="renova-worker-stop-waiter")
    exit_code = 0
    try:
        done, _pending = await asyncio.wait(
            [stop_waiter, *tasks],
            return_when=asyncio.FIRST_COMPLETED,
        )
        unexpected = [task for task in done if task is not stop_waiter]
        if unexpected and not stop.is_set():
            exit_code = 1
            for task in unexpected:
                if task.cancelled():
                    logger.error("worker task exited unexpectedly: %s", task.get_name())
                else:
                    error = task.exception()
                    if error is None:
                        logger.error("worker task returned unexpectedly: %s", task.get_name())
                    else:
                        logger.error(
                            "worker task crashed: %s (%s)",
                            task.get_name(),
                            type(error).__name__,
                        )
            stop.set()
    finally:
        stop.set()
        stop_waiter.cancel()
        await asyncio.gather(stop_waiter, return_exceptions=True)
        await _graceful_stop(tasks)
        await publisher.remove()
        await publisher.close()
        try:
            await rate_limiter.close()
        finally:
            await asyncio.to_thread(observability_runtime.shutdown)
        logger.info("renova worker stopped exit_code=%s", exit_code)
    return exit_code


def main() -> int:
    return asyncio.run(run_worker())


if __name__ == "__main__":
    raise SystemExit(main())
