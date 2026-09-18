"""One forecast, or none — never a number that only looks like one.

Three places forecast the final cost, and all three were wrong in a different
way:

    risk_engine        spent + (planned - spent) * (100 - progress) / max(progress, 1)
    analytics          spent / (max(progress_percent, 1) / 100)
    budget_summary     spent / (progress / 100) if progress > 5 else planned

The first does not extrapolate spending at all: it scales the *unspent* budget
by the ratio of work left to work done, so at zero spend the answer is
independent of what has been spent, and below one percent of progress the
divisor clamps to 1 and the multiplier reaches ninety-nine. It reported
"+18 754 332 ₽ к смете" on a project with an estimate of 194 437 ₽ and nothing
spent.

The second and third have the right shape and read `projects.progress_percent`
— a column nothing updates except the demo seeder. At the stored 0 that makes
the forecast the spend multiplied by a hundred: 16 734 393 ₽ on a project
running exactly to plan.

The third also substitutes the plan when progress is too low, which is a
different untruth: it says "we forecast exactly on plan" where it means "we
cannot tell yet".

The honest calculation is the spend extrapolated over the work done. It is
meaningless before there is enough of both, and this module returns None there
so a caller can say so rather than print a figure.
"""

from __future__ import annotations

#: Below this, extrapolation amplifies noise more than it predicts anything: at
#: 2% complete a single early delivery triples the forecast. The threshold is a
#: judgement, not a constant of nature, and it is named so it can be argued
#: with in one place instead of three.
MIN_PROGRESS_PCT = 10.0


def forecast_total(spent: float | None, progress_pct: float | None) -> float | None:
    """Projected final cost, or None when it cannot honestly be given.

    None means "not enough has happened yet", and a caller must render that as
    absence — a dash, an empty slot — not as zero and not as the plan.
    """
    spend = float(spent or 0)
    progress = float(progress_pct or 0)

    if progress < MIN_PROGRESS_PCT:
        return None
    if spend <= 0:
        # Nothing has been spent, so there is no rate to extend. A project can
        # legitimately be 30% done with the first invoice still unpaid.
        return None
    if progress >= 100:
        # The work is finished; the spend is the total, not a projection.
        return round(spend, 2)

    return round(spend / (progress / 100.0), 2)


def forecast_overrun(forecast: float | None, planned: float | None) -> float | None:
    """How far the forecast exceeds the plan, or None when there is no forecast.

    Never negative: an underrun is not an overrun, and reporting it as one is
    how "экономия −185 938 ₽" happens.
    """
    if forecast is None:
        return None
    plan = float(planned or 0)
    if plan <= 0:
        return None
    return round(max(0.0, forecast - plan), 2)


def forecast_risk(forecast: float | None, planned: float | None, *, threshold_pct: float = 5.0) -> str:
    """`ok`, `high`, or `unknown` — which is a third answer, not a bad `ok`."""
    overrun = forecast_overrun(forecast, planned)
    if overrun is None:
        return "unknown"
    plan = float(planned or 0)
    return "high" if overrun > plan * (threshold_pct / 100.0) else "ok"
