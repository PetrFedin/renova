/** Канонический demo-объект — не Wizard Test / E2E-мусор из projects[0]. */
export type ProjectPick = { id: string; name?: string | null };

export function pickPrimaryDemoProject<T extends ProjectPick>(projects: T[]): T | null {
  if (!projects.length) return null;
  return (
    projects.find((p) => p.name?.includes('Демо-квартира')) ??
    projects.find((p) => p.name?.includes('Демо-дом')) ??
    projects.find((p) => !/wizard|test/i.test(p.name ?? '')) ??
    projects[0]
  );
}
