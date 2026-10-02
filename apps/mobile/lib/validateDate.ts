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

/** «2026-06-28» → «28.06.2026»; не-ISO значение (пользователь ещё печатает) возвращается как есть. */
export function isoToRuDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/**
 * Маска ввода «ДД.ММ.ГГГГ»: оставляет цифры и добавляет точки сам. Если пользователь вставил/ввёл
 * ISO («2026-06-28»), оставляет как есть, чтобы parseDateInput его принял.
 */
export function maskRuDateInput(value: string): string {
  if (/^\d{4}-/.test(value)) return value.replace(/[^\d-]/g, '').slice(0, 10);
  const d = value.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}
