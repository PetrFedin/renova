/** Document Center — единый индекс документов проекта */
export type ProjectDocumentSource = 'design' | 'receipt' | 'export' | string;

export type ProjectDocument = {
  id: string;
  source: ProjectDocumentSource;
  kind: string;
  title: string;
  status: string;
  href: string | null;
  created_at: string | null;
  amount: number | null;
  verified: boolean | null;
  version: number | null;
  meta?: Record<string, unknown>;
};

export type ProjectDocumentsResponse = {
  project_id: string;
  project_name: string;
  items: ProjectDocument[];
  counts: {
    total: number;
    design: number;
    receipts: number;
    exports: number;
  };
};
