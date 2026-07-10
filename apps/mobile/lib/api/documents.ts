/** API: Document Center */
import { req } from './client';
import type { ProjectDocumentsResponse } from './types';

export const documentsApi = {
  listProjectDocuments: (userId: string, projectId: string) => req<ProjectDocumentsResponse>(
    `/api/v1/projects/${projectId}/documents`,
    {},
    userId,
  ),
};
