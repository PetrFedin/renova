/** Простая проверка ISO-даты YYYY-MM-DD */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function normalizeIsoDateInput(value: string): string {
  return value.replace(/[^\d-]/g, '').slice(0, 10);
}

/**
 * Свободный ввод даты → ISO (YYYY-MM-DD). Принимает «2026-06-28» и «28.06.2026» (также «/» и «-» как разделители).
 * Возвращает null, если дата невалидна (несуществующий день/месяц, мусор).
 */
export function parseDateInput(value: string): string | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

export type DateFieldCheck = { ok: true; iso: string | undefined } | { ok: false; error: string };

/** Необязательное поле даты: пусто → ok без значения; иначе обязана быть валидной. */
export function checkOptionalDate(value: string, label: string): DateFieldCheck {
  if (!value.trim()) return { ok: true, iso: undefined };
  const iso = parseDateInput(value);
  if (!iso) return { ok: false, error: `${label}: введите дату как ДД.ММ.ГГГГ или ГГГГ-ММ-ДД` };
  return { ok: true, iso };
}

/** Начало/окончание: обе необязательны, но если обе есть — окончание не раньше начала. */
export function checkDateRange(
  startRaw: string,
  endRaw: string,
  labels: { start: string; end: string } = { start: 'Начало', end: 'Окончание' },
): { ok: true; start: string | undefined; end: string | undefined } | { ok: false; error: string } {
  const s = checkOptionalDate(startRaw, labels.start);
  if (!s.ok) return s;
  const e = checkOptionalDate(endRaw, labels.end);
  if (!e.ok) return e;
  if (s.iso && e.iso && e.iso < s.iso) return { ok: false, error: `${labels.end} не может быть раньше даты «${labels.start.toLowerCase()}»` };
  return { ok: true, start: s.iso, end: e.iso };
}

/** «ГГГГ-ММ-ДД ЧЧ:ММ» / «ГГГГ-ММ-ДДTЧЧ:ММ» / «ДД.ММ.ГГГГ ЧЧ:ММ» → «ГГГГ-ММ-ДДTЧЧ:ММ:00» или null. */
export function parseDateTimeInput(value: string): string | null {
  const m = /^(\S+)[\sT]+(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const date = parseDateInput(m[1]);
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (!date || h > 23 || min > 59) return null;
  return `${date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}
