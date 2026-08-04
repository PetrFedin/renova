"""Register all ORM model modules in one deterministic package import."""
from __future__ import annotations

# entities remains the compatibility surface for the decomposed model package.
from app.models import entities as entities
from app.models.calendar import CalendarItem as CalendarItem

__all__ = ["entities", "CalendarItem"]
