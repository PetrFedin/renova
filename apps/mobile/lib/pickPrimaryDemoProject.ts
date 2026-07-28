/** Канонический demo-объект — не Wizard Test / E2E-мусор из projects[0]. */
import { isJunkProjectName } from './junkProjects';

export type ProjectPick = { id: string; name?: string | null };

export function pickPrimaryDemoProject<T extends ProjectPick>(projects: T[]): T | null {
  if (!projects.length) return null;
  const clean = projects.filter((p) => !isJunkProjectName(p.name));
  const pool = clean.length ? clean : projects;
  return (
    pool.find((p) => p.name?.includes('Демо-квартира')) ??
    pool.find((p) => p.name?.includes('Демо-дом')) ??
    pool[0]
  );
}
