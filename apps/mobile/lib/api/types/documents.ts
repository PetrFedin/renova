/** Document Center — единый индекс документов проекта */
export type ProjectDocumentSource = 'design' | 'receipt' | 'export' | 'canonical' | 'acceptance' | string;

export type ProjectDocumentOcr = {
  status?: string | null;
  job_id?: string | null;
  suggested_type?: string | null;
  confidence?: number | null;
  completed_at?: string | null;
  error?: string | null;
};

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
  meta?: {
    legal_hold?: boolean;
    retention_until?: string | null;
    ocr?: ProjectDocumentOcr | null;
    signatures?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
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
    acceptances?: number;
  };
};
