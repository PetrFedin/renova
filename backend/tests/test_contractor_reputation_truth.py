"""Оценка исполнителя — измерение или ничто, но не значение по умолчанию.

Найдено разбором полей моделей: три вопроса к каждому полю — кто пишет,
кто показывает, что проверяет. У `contractor_profiles.rating` ответ на
первый вопрос оказался «никто»: колонка объявлена `Float, default=5.0`,
модели отзывов в схеме нет, присваивания нет ни в одной строке кода.

При этом число показывалось заказчику как «★5» и — хуже — участвовало в
ранжировании: `score = profile.rating` в подборе и в автоназначении
заявки. Одинаковое у всех слагаемое означало, что при отсутствии
совпадения по специализации «лучшим исполнителем» становилась первая
строка выборки.
"""
import pytest

from app.services import contractor_reputation_service as reputation


class Profile:
    def __init__(self, id="p1", rating=5.0, jobs_done=0, specialties=None):
        self.id = id
        self.rating = rating
        self.jobs_done = jobs_done
        self.specialties = specialties


class Contractor:
    def __init__(self, id="u1"):
        self.id = id


def test_rating_source_is_declared_not_assumed():
    # Эта проверка — сигнализация. Заведут отзывы и забудут объявить
    # источник — она не упадёт; объявят источник, а показ не поправят —
    # упадут соседние. Молча разъехаться не получится.
    assert reputation.RATING_SOURCES == (), (
        "источник оценок объявлен — значит public_rating должен отдавать число, "
        "и проверки ниже надо переписать под реальные данные"
    )


def test_unmeasured_rating_is_not_a_number():
    assert reputation.public_rating(Profile(rating=5.0)) is None
    # И «четвёрка по умолчанию» тоже не измерение.
    assert reputation.public_rating(Profile(rating=4.0)) is None


def test_unmeasured_jobs_done_is_not_zero():
    # Ноль читается как «сдал ноль объектов». Мы этого не знаем.
    assert reputation.public_jobs_done(Profile(jobs_done=0)) is None


def test_match_score_does_not_include_the_invented_rating():
    without = reputation.match_score(Profile(specialties=None), specialty="tiling")
    assert without == 0.0, "в балл подбора подмешано что-то, чего мы не измеряли"


def test_match_score_counts_only_what_the_contractor_declared():
    p = Profile(specialties="tiling,painting")
    assert reputation.match_score(p, specialty="tiling") == 2.0
    assert reputation.match_score(p, renovation_type="painting") == 1.0
    assert reputation.match_score(p, specialty="tiling", renovation_type="painting") == 3.0
    assert reputation.match_score(p, specialty="plumbing") == 0.0


def test_ranking_is_stable_when_nothing_distinguishes_them():
    # Раньше при равных баллах выигрывал порядок выборки из базы.
    rows = [
        (Profile(id="zzz"), Contractor("u-z")),
        (Profile(id="aaa"), Contractor("u-a")),
        (Profile(id="mmm"), Contractor("u-m")),
    ]
    first = [p.id for p, _, _ in reputation.ranked(rows)]
    second = [p.id for p, _, _ in reputation.ranked(list(reversed(rows)))]
    assert first == second == ["aaa", "mmm", "zzz"]


def test_ranking_puts_the_actual_match_first():
    rows = [
        (Profile(id="aaa", specialties=None), Contractor("u-a")),
        (Profile(id="zzz", specialties="tiling"), Contractor("u-z")),
    ]
    ranked = reputation.ranked(rows, specialty="tiling")
    assert [p.id for p, _, _ in ranked] == ["zzz", "aaa"]
    assert ranked[0][2] == 2.0


def test_basis_says_why_in_words():
    matched = reputation.match_basis(Profile(specialties="tiling"), specialty="tiling")
    assert "tiling" in matched and "Совпало" in matched

    unmatched = reputation.match_basis(Profile(specialties=None), specialty="tiling")
    # Молчание здесь было бы хуже: заказчик решил бы, что это подбор.
    assert "нет" in unmatched.lower()


@pytest.mark.asyncio
async def test_no_code_path_writes_the_rating():
    """Само утверждение «никто не пишет» тоже держим проверкой."""
    import pathlib, re

    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    writers = []
    for path in app_dir.rglob("*.py"):
        if "__pycache__" in str(path):
            continue
        for num, line in enumerate(path.read_text().splitlines(), 1):
            if re.search(r"\.(rating|jobs_done)\s*=(?!=)", line):
                writers.append(f"{path.name}:{num}")
    assert not writers, (
        "оценку начали писать — значит она стала измерением, "
        f"и показ пора включать обратно: {writers}"
    )
