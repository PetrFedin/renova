"""Seed pre-w21 material price rows using only the physical w20 schema.

This script deliberately does not import ``app.models``.  A migration backfill
must be qualified against the predecessor schema itself; importing the current
ORM would couple the fixture to columns that do not exist until w21.
"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


DATABASE_URL = os.environ["DATABASE_URL"]


async def main() -> None:
    engine = create_async_engine(DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    INSERT INTO users
                    (id, phone, role, moy_nalog_linked, npd_verified, created_at)
                    VALUES
                    ('price-migration-customer', '+79990000101', 'customer', false, false, CURRENT_TIMESTAMP)
                    """
                )
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO projects
                    (id, name, renovation_type, property_type, customer_id,
                     budget_planned, budget_spent, progress_percent, created_at)
                    VALUES
                    ('price-migration-project', 'Price migration fixture', 'cosmetic', 'apartment',
                     'price-migration-customer', 0, 0, 0, CURRENT_TIMESTAMP)
                    """
                )
            )
            statement = text(
                """
                INSERT INTO material_picks
                (id, project_id, name, qty, unit, price, qty_delivered, status,
                 supply_source, qty_available, created_at, updated_at)
                VALUES
                (:id, 'price-migration-project', :name, 1, 'шт', :price, 0, 'draft',
                 'customer_to_buy', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """
            )
            for row in (
                {"id": "price-historical-zero", "name": "Zero", "price": 0.0},
                {"id": "price-historical-normal", "name": "Normal", "price": 2500.0},
                {"id": "price-historical-stub-shape", "name": "Old stub shape", "price": 1000.0},
            ):
                await conn.execute(statement, row)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
