/** Общие хелперы E2E — один demo-customer на БД, стабильный проект не «Wizard Test». */
export const API = process.env.RENOVA_API ?? 'http://127.0.0.1:8100';

export type DemoProject = {
  id: string;
  name: string;
  budget_spent?: number;
  contractor_id?: string | null;
  rooms?: { id: string }[];
  stages?: { id: string; status: string }[];
};

/** Канонический объект для прогона «серьёзный клиент» — не первый projects[0] из wizard/E2E. */
export function pickPrimaryDemoProject(projects: DemoProject[]): DemoProject {
  return (
    projects.find((p) => p.name?.includes('Демо-квартира')) ??
    projects.find((p) => p.name?.includes('Демо-дом')) ??
    projects.find((p) => !/wizard|test/i.test(p.name ?? '')) ??
    projects[0]
  );
}
