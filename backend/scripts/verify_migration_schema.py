"""Reflect the database and enforce the current Alembic schema contract.

The verifier never imports ORM metadata. It runs after real Alembic transitions
so model-only schema changes cannot create a false production-readiness signal.
"""
from __future__ import annotations

import argparse
import asyncio
import os

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


_PRESENT_REVISION = "w13ormparity01"
_ABSENT_REVISION = "w6webhookdelivery01"


class SchemaMismatch(RuntimeError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SchemaMismatch(message)


def _current_revision(sync_connection) -> str:
    value = sync_connection.execute(
        text("SELECT version_num FROM alembic_version")
    ).scalar_one()
    return str(value)


def _verify_calendar(inspector) -> None:
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    _require("ics_token" in user_columns, "users.ics_token is missing after Alembic upgrade")
    _require(user_columns["ics_token"].get("nullable") is True, "users.ics_token must be nullable")
    user_indexes = {
        index["name"]: index
        for index in inspector.get_indexes("users")
        if index.get("name")
    }
    ics_index = user_indexes.get("ix_users_ics_token")
    _require(ics_index is not None, "ix_users_ics_token is missing")
    _require(bool(ics_index.get("unique")), "ix_users_ics_token must be unique")
    _require(
        list(ics_index.get("column_names") or []) == ["ics_token"],
        "ix_users_ics_token must target only users.ics_token",
    )

    expected_columns = {
        "id", "user_id", "project_id", "stage_id", "title", "description",
        "start_at", "end_at", "all_day", "event_type", "color", "is_public",
        "recurrence", "location", "reminder_at", "reminder_sent", "created_at",
        "updated_at",
    }
    columns = {column["name"]: column for column in inspector.get_columns("calendar_items")}
    missing = expected_columns - set(columns)
    _require(not missing, f"calendar_items columns are missing: {sorted(missing)}")
    nullable = {
        "project_id", "stage_id", "description", "color", "recurrence", "location",
        "reminder_at",
    }
    for name in expected_columns:
        _require(
            bool(columns[name].get("nullable")) is (name in nullable),
            f"calendar_items.{name} nullable mismatch",
        )
    _require(
        list(inspector.get_pk_constraint("calendar_items").get("constrained_columns") or []) == ["id"],
        "calendar_items primary key must be id",
    )
    foreign_keys = {
        tuple(foreign_key.get("constrained_columns") or []): (
            foreign_key.get("referred_table"),
            tuple(foreign_key.get("referred_columns") or []),
        )
        for foreign_key in inspector.get_foreign_keys("calendar_items")
    }
    for columns_key, target in {
        ("user_id",): ("users", ("id",)),
        ("project_id",): ("projects", ("id",)),
        ("stage_id",): ("stages", ("id",)),
    }.items():
        _require(
            foreign_keys.get(columns_key) == target,
            f"calendar_items foreign key mismatch for {columns_key}: {foreign_keys.get(columns_key)}",
        )
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("calendar_items")
        if index.get("name")
    }
    for name, expected in {
        "ix_calendar_items_user_id": ["user_id"],
        "ix_calendar_items_project_id": ["project_id"],
        "ix_calendar_items_stage_id": ["stage_id"],
        "ix_calendar_items_start_at": ["start_at"],
        "ix_calendar_items_end_at": ["end_at"],
        "ix_calendar_items_event_type": ["event_type"],
        "ix_calendar_items_is_public": ["is_public"],
        "ix_calendar_items_reminder_at": ["reminder_at"],
    }.items():
        index = indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(list(index.get("column_names") or []) == expected, f"{name} columns mismatch")
        _require(not bool(index.get("unique")), f"{name} must not be unique")


def _verify_subscription_checkouts(inspector) -> None:
    expected_columns = {
        "id", "user_id", "open_key", "status", "amount", "currency", "days",
        "idempotence_key", "provider_payment_id", "confirmation_url", "provider_status",
        "entitlement_before_status", "entitlement_before_plan",
        "entitlement_before_expires_at", "entitlement_after_expires_at",
        "refunded_amount", "entitlement_reversed_at", "completed_at", "replay_until",
        "created_at", "updated_at",
    }
    columns = {
        column["name"]: column
        for column in inspector.get_columns("subscription_checkouts")
    }
    missing = expected_columns - set(columns)
    _require(not missing, f"subscription_checkouts columns are missing: {sorted(missing)}")
    nullable = {
        "open_key", "provider_payment_id", "confirmation_url", "provider_status",
        "entitlement_before_status", "entitlement_before_plan",
        "entitlement_before_expires_at", "entitlement_after_expires_at",
        "entitlement_reversed_at", "completed_at", "replay_until",
    }
    for name in expected_columns:
        _require(
            bool(columns[name].get("nullable")) is (name in nullable),
            f"subscription_checkouts.{name} nullable mismatch",
        )
    _require(
        list(inspector.get_pk_constraint("subscription_checkouts").get("constrained_columns") or []) == ["id"],
        "subscription_checkouts primary key must be id",
    )
    _require(
        any(
            list(foreign_key.get("constrained_columns") or []) == ["user_id"]
            and foreign_key.get("referred_table") == "users"
            and list(foreign_key.get("referred_columns") or []) == ["id"]
            for foreign_key in inspector.get_foreign_keys("subscription_checkouts")
        ),
        "subscription_checkouts.user_id foreign key is missing",
    )
    unique_constraints = {
        constraint["name"]: list(constraint.get("column_names") or [])
        for constraint in inspector.get_unique_constraints("subscription_checkouts")
        if constraint.get("name")
    }
    _require(
        unique_constraints.get("uq_subscription_checkout_open_key") == ["open_key"],
        "subscription checkout open_key uniqueness is missing",
    )
    _require(
        unique_constraints.get("uq_subscription_checkout_idempotence_key") == ["idempotence_key"],
        "subscription checkout idempotence uniqueness is missing",
    )
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("subscription_checkouts")
        if index.get("name")
    }
    for name, (expected, unique) in {
        "ix_subscription_checkouts_user_id": (["user_id"], False),
        "ix_subscription_checkouts_status": (["status"], False),
        "ix_subscription_checkouts_provider_payment_id": (["provider_payment_id"], True),
        "ix_subscription_checkouts_replay_until": (["replay_until"], False),
    }.items():
        index = indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(list(index.get("column_names") or []) == expected, f"{name} columns mismatch")
        _require(bool(index.get("unique")) is unique, f"{name} unique mismatch")


def _verify_subscription_refunds(inspector) -> None:
    expected_columns = {
        "id", "checkout_id", "user_id", "provider_refund_id", "provider_payment_id",
        "amount", "currency", "status", "entitlement_changed", "reason",
        "review_status", "review_owner_id", "review_claimed_at",
        "review_claim_expires_at", "review_version", "resolution",
        "resolution_note", "decision_key", "reviewed_by_id", "reviewed_at",
        "created_at", "applied_at",
    }
    columns = {
        column["name"]: column
        for column in inspector.get_columns("subscription_refunds")
    }
    missing = expected_columns - set(columns)
    _require(not missing, f"subscription_refunds columns are missing: {sorted(missing)}")
    nullable = {
        "checkout_id", "user_id", "reason", "review_owner_id", "review_claimed_at",
        "review_claim_expires_at", "resolution", "resolution_note", "decision_key",
        "reviewed_by_id", "reviewed_at", "applied_at",
    }
    for name in expected_columns:
        _require(
            bool(columns[name].get("nullable")) is (name in nullable),
            f"subscription_refunds.{name} nullable mismatch",
        )
    _require(
        list(inspector.get_pk_constraint("subscription_refunds").get("constrained_columns") or []) == ["id"],
        "subscription_refunds primary key must be id",
    )
    foreign_keys = {
        tuple(foreign_key.get("constrained_columns") or []): (
            foreign_key.get("referred_table"),
            tuple(foreign_key.get("referred_columns") or []),
        )
        for foreign_key in inspector.get_foreign_keys("subscription_refunds")
    }
    for columns_key, target in {
        ("checkout_id",): ("subscription_checkouts", ("id",)),
        ("user_id",): ("users", ("id",)),
        ("review_owner_id",): ("users", ("id",)),
        ("reviewed_by_id",): ("users", ("id",)),
    }.items():
        _require(
            foreign_keys.get(columns_key) == target,
            f"subscription_refunds foreign key mismatch for {columns_key}",
        )
    unique_constraints = {
        constraint["name"]: list(constraint.get("column_names") or [])
        for constraint in inspector.get_unique_constraints("subscription_refunds")
        if constraint.get("name")
    }
    _require(
        unique_constraints.get("uq_subscription_refunds_decision_key") == ["decision_key"],
        "subscription_refunds decision key uniqueness is missing",
    )
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("subscription_refunds")
        if index.get("name")
    }
    for name, (expected, unique) in {
        "ix_subscription_refunds_checkout_id": (["checkout_id"], False),
        "ix_subscription_refunds_user_id": (["user_id"], False),
        "ix_subscription_refunds_provider_refund_id": (["provider_refund_id"], True),
        "ix_subscription_refunds_provider_payment_id": (["provider_payment_id"], False),
        "ix_subscription_refunds_status": (["status"], False),
        "ix_subscription_refunds_review_status": (["review_status"], False),
        "ix_subscription_refunds_review_owner_id": (["review_owner_id"], False),
        "ix_subscription_refunds_review_claim_expires_at": (["review_claim_expires_at"], False),
        "ix_subscription_refunds_reviewed_by_id": (["reviewed_by_id"], False),
    }.items():
        index = indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(list(index.get("column_names") or []) == expected, f"{name} columns mismatch")
        _require(bool(index.get("unique")) is unique, f"{name} unique mismatch")


def _verify_subscription_refund_review_events(inspector) -> None:
    expected_columns = {
        "id", "refund_id", "actor_id", "event_type", "from_status",
        "to_status", "payload_json", "created_at",
    }
    columns = {
        column["name"]: column
        for column in inspector.get_columns("subscription_refund_review_events")
    }
    missing = expected_columns - set(columns)
    _require(
        not missing,
        f"subscription_refund_review_events columns are missing: {sorted(missing)}",
    )
    nullable = {"from_status", "to_status", "payload_json"}
    for name in expected_columns:
        _require(
            bool(columns[name].get("nullable")) is (name in nullable),
            f"subscription_refund_review_events.{name} nullable mismatch",
        )
    _require(
        list(
            inspector.get_pk_constraint("subscription_refund_review_events").get(
                "constrained_columns"
            )
            or []
        )
        == ["id"],
        "subscription_refund_review_events primary key must be id",
    )
    foreign_keys = {
        tuple(foreign_key.get("constrained_columns") or []): (
            foreign_key.get("referred_table"),
            tuple(foreign_key.get("referred_columns") or []),
        )
        for foreign_key in inspector.get_foreign_keys(
            "subscription_refund_review_events"
        )
    }
    for columns_key, target in {
        ("refund_id",): ("subscription_refunds", ("id",)),
        ("actor_id",): ("users", ("id",)),
    }.items():
        _require(
            foreign_keys.get(columns_key) == target,
            f"subscription_refund_review_events foreign key mismatch for {columns_key}",
        )
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("subscription_refund_review_events")
        if index.get("name")
    }
    for name, expected in {
        "ix_subscription_refund_review_events_refund_id": ["refund_id"],
        "ix_subscription_refund_review_events_actor_id": ["actor_id"],
        "ix_subscription_refund_review_events_event_type": ["event_type"],
        "ix_subscription_refund_review_events_created_at": ["created_at"],
    }.items():
        index = indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(list(index.get("column_names") or []) == expected, f"{name} columns mismatch")
        _require(not bool(index.get("unique")), f"{name} must not be unique")


def _verify_push_receipts(inspector) -> None:
    expected_columns = {
        "id", "expo_receipt_id", "push_token_id", "token_fingerprint", "delivery_id",
        "status", "attempts", "provider_error", "provider_message", "next_attempt_at",
        "locked_at", "locked_by", "checked_at", "completed_at", "expires_at",
        "created_at", "updated_at",
    }
    columns = {
        column["name"]: column
        for column in inspector.get_columns("expo_push_receipts")
    }
    missing = expected_columns - set(columns)
    _require(not missing, f"expo_push_receipts columns are missing: {sorted(missing)}")
    nullable = {
        "push_token_id", "delivery_id", "provider_error", "provider_message",
        "next_attempt_at", "locked_at", "locked_by", "checked_at", "completed_at",
    }
    for name in expected_columns:
        _require(
            bool(columns[name].get("nullable")) is (name in nullable),
            f"expo_push_receipts.{name} nullable mismatch",
        )
    _require(
        list(inspector.get_pk_constraint("expo_push_receipts").get("constrained_columns") or []) == ["id"],
        "expo_push_receipts primary key must be id",
    )
    foreign_keys = inspector.get_foreign_keys("expo_push_receipts")
    token_fk = next(
        (
            foreign_key
            for foreign_key in foreign_keys
            if list(foreign_key.get("constrained_columns") or []) == ["push_token_id"]
        ),
        None,
    )
    _require(token_fk is not None, "expo_push_receipts.push_token_id foreign key is missing")
    _require(token_fk.get("referred_table") == "push_tokens", "push receipt token FK table mismatch")
    _require(
        list(token_fk.get("referred_columns") or []) == ["id"],
        "push receipt token FK column mismatch",
    )
    _require(
        str((token_fk.get("options") or {}).get("ondelete") or "").upper() == "SET NULL",
        "push receipt token FK must use ON DELETE SET NULL",
    )
    indexes = {
        index["name"]: index
        for index in inspector.get_indexes("expo_push_receipts")
        if index.get("name")
    }
    for name, (expected, unique) in {
        "ix_expo_push_receipts_expo_receipt_id": (["expo_receipt_id"], True),
        "ix_expo_push_receipts_push_token_id": (["push_token_id"], False),
        "ix_expo_push_receipts_delivery_id": (["delivery_id"], False),
        "ix_expo_push_receipts_status": (["status"], False),
        "ix_expo_push_receipts_next_attempt_at": (["next_attempt_at"], False),
        "ix_expo_push_receipts_locked_at": (["locked_at"], False),
        "ix_expo_push_receipts_expires_at": (["expires_at"], False),
        "ix_expo_push_receipts_created_at": (["created_at"], False),
    }.items():
        index = indexes.get(name)
        _require(index is not None, f"{name} is missing")
        _require(list(index.get("column_names") or []) == expected, f"{name} columns mismatch")
        _require(bool(index.get("unique")) is unique, f"{name} unique mismatch")


def _verify_present(sync_connection) -> None:
    _require(
        _current_revision(sync_connection) == _PRESENT_REVISION,
        f"Alembic head must be {_PRESENT_REVISION}",
    )
    inspector = inspect(sync_connection)
    tables = set(inspector.get_table_names())
    for table in (
        "users",
        "calendar_items",
        "subscription_checkouts",
        "subscription_refunds",
        "subscription_refund_review_events",
        "expo_push_receipts",
    ):
        _require(table in tables, f"{table} table is missing after Alembic upgrade")
    _verify_calendar(inspector)
    _verify_subscription_checkouts(inspector)
    _verify_subscription_refunds(inspector)
    _verify_subscription_refund_review_events(inspector)
    _verify_push_receipts(inspector)


def _verify_absent(sync_connection) -> None:
    _require(
        _current_revision(sync_connection) == _ABSENT_REVISION,
        f"Alembic revision after downgrade must be {_ABSENT_REVISION}",
    )
    inspector = inspect(sync_connection)
    tables = set(inspector.get_table_names())
    for table in (
        "calendar_items",
        "subscription_checkouts",
        "subscription_refunds",
        "subscription_refund_review_events",
        "expo_push_receipts",
    ):
        _require(table not in tables, f"{table} survived downgrade to the previous revision")
    _require("users" in tables, "users table disappeared during schema downgrade")
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    _require("ics_token" not in user_columns, "users.ics_token survived downgrade")
    user_indexes = {
        index["name"]
        for index in inspector.get_indexes("users")
        if index.get("name")
    }
    _require("ix_users_ics_token" not in user_indexes, "ix_users_ics_token survived downgrade")


async def _main(expect: str) -> None:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    _require(bool(database_url), "DATABASE_URL is required")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            verifier = _verify_present if expect == "present" else _verify_absent
            await connection.run_sync(verifier)
    finally:
        await engine.dispose()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expect",
        choices=("present", "absent"),
        default="present",
        help="Expected state of the current migrations relative to w6.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = _parse_args()
    asyncio.run(_main(arguments.expect))
