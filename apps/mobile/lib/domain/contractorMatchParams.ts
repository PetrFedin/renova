/** MKT-009: параметры подбора исполнителя берутся из объекта, а не зашиты в вызов. */
type ProjectLike = {
  renovation_type?: string | null;
  stages?: { work_type?: string | null }[] | null;
};

export type ContractorMatchParams = { renovationType?: string; specialty?: string };

/** Тип ремонта объекта и самый частый вид работ по его этапам; чего не знаем — не придумываем. */
export function contractorMatchParams(project: ProjectLike | null | undefined): ContractorMatchParams {
  if (!project) return {};
  const counts = new Map<string, number>();
  for (const stage of project.stages ?? []) {
    const type = (stage.work_type || '').trim();
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  // При равенстве — по алфавиту, чтобы результат не зависел от порядка этапов.
  const specialty = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const renovationType = (project.renovation_type || '').trim() || undefined;
  return { ...(renovationType ? { renovationType } : {}), ...(specialty ? { specialty } : {}) };
}
