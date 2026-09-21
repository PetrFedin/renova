"""§4.5 Статусы этапов — вычисляемые display_status + weighted progress."""
from __future__ import annotations

from datetime import date

from app.models.entities import MaterialPick, Stage, StageStatus
from app.services import workflow_service as wf


DISPLAY_LABELS: dict[str, str] = {
    "not_started": "Не начат",
    "preparation": "Подготовка",
    "in_progress": "В работе",
    "paused": "На паузе",
    "waiting_materials": "Ожидает материалы",
    "waiting_acceptance": "Ожидает приёмку",
    "completed": "Завершён",
    "archive": "Архив",
}


def compute_display_status(
    stage: Stage,
    *,
    blocked: bool = False,
    waiting_materials: bool = False,
    paused: bool = False,
) -> str:
    """§4.5 — статус этапа из фактического состояния."""
    st = stage.status
    if st == StageStatus.done:
        return "completed"
    if st == StageStatus.review:
        return "waiting_acceptance"
    if paused:
        return "paused"
    if blocked or waiting_materials:
        return "waiting_materials"
    if st == StageStatus.active:
        if getattr(stage, "needs_rework", False):
            return "in_progress"
        name = (stage.name or "").lower()
        if "подготов" in name and stage.percent_complete < 30:
            return "preparation"
        return "in_progress"
    if st == StageStatus.planned:
        return "not_started"
    return "not_started"


def display_status_label(code: str) -> str:
    return DISPLAY_LABELS.get(code, code)


def works_counts(stage: Stage) -> tuple[int, int]:
    """§4.6 — работы = пункты чек-листа этапа."""
    items = wf.stage_checklist(stage)
    if not items:
        return 0, 0
    done = sum(1 for i in items if i.get("done"))
    return len(items), done


def weighted_progress(stages: list[Stage]) -> float:
    """§4.8–4.9 — прогресс проекта по весам этапов."""
    if not stages:
        return 0.0
    total_w = sum(getattr(s, "weight_coefficient", 0) or 0 for s in stages)
    if total_w <= 0:
        return round(sum(s.percent_complete for s in stages) / len(stages), 1)
    acc = sum((getattr(s, "weight_coefficient", 0) or 0) * s.percent_complete for s in stages)
    return round(acc / total_w, 1)


# Ниже этой доли выполненных работ прогноз по темпу не имеет смысла: делить
# факт на почти нулевой прогресс — значит получать любое число. При таком
# прогрессе прогнозом остаётся план.
FORECAST_MIN_PROGRESS_PCT = 5.0


def burn_forecast(*, spent: float, planned: float, progress_percent: float) -> float:
    """Прогноз итоговой суммы по темпу расходования.

    Одна формула на весь продукт. До неё их было две: сводка бюджета делила
    факт на прогресс только при прогрессе выше 5 %, а аналитика делила всегда,
    подставляя вместо нуля единицу — и превращала факт в стократный прогноз.
    """
    if progress_percent > FORECAST_MIN_PROGRESS_PCT:
        return round(spent / (progress_percent / 100), 2)
    return round(planned, 2)


def project_progress(project) -> float:
    """Прогресс объекта — всегда по этапам, а не по колонке в проекте.

    `projects.progress_percent` в продукте не вычисляется ни одной записью:
    единственное присваивание живёт в демо-заполнении. Все, кто её читал,
    получали ноль, а экран объекта показывал «работы 0 %» на объекте, где
    работы идут.
    """
    return weighted_progress(list(getattr(project, "stages", None) or []))


def delay_days(stage: Stage, today: date | None = None) -> int:
    today = today or date.today()
    if not stage.planned_end or stage.status == StageStatus.done:
        return 0
    if stage.planned_end >= today:
        return 0
    return (today - stage.planned_end).days
