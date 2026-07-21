/** Сброс offline-мутаций проекта после archive/trash — иначе flush бьётся в 404. */

export function jobPathMatchesProject(path: string, projectId: string): boolean {
  if (!projectId) return false;
  return path.includes(`/projects/${projectId}`);
}

export function filterJobsExceptProject<T extends { path: string }>(jobs: T[], projectId: string): T[] {
  return jobs.filter((j) => !jobPathMatchesProject(j.path, projectId));
}
