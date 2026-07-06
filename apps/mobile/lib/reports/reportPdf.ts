/** PDF отчётов — открыть в приложении, поделиться, скачать (web) */
import { fetchPdfBlob, openPdfBlob } from '@/lib/pdfOpen';
import {
  buildReportPdfQuery,
  type ExpenseCategoryId,
  type FinalReportSectionId,
} from './reportSections';

export type ReportPdfKind = 'daily' | 'weekly' | 'final';

export function reportPdfPath(
  projectId: string,
  kind: ReportPdfKind,
  opts?: { sections?: FinalReportSectionId[]; categories?: ExpenseCategoryId[] },
): string {
  const base = `/api/v1/projects/${projectId}/reports/${kind}.pdf`;
  if (kind !== 'final' || !opts) return base;
  return `${base}${buildReportPdfQuery(opts.sections || [], opts.categories || [])}`;
}

export function reportPdfFilename(kind: ReportPdfKind, projectId: string, partial?: boolean): string {
  const suffix = partial ? '-partial' : '';
  return `${kind}-report-${projectId.slice(0, 8)}${suffix}.pdf`;
}

export async function previewReportPdf(
  userId: string,
  projectId: string,
  kind: ReportPdfKind,
  opts?: { sections?: FinalReportSectionId[]; categories?: ExpenseCategoryId[] },
) {
  const path = reportPdfPath(projectId, kind, opts);
  const partial = kind === 'final' && !!path.includes('?');
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, reportPdfFilename(kind, projectId, partial), 'preview');
}

export async function shareReportPdf(
  userId: string,
  projectId: string,
  kind: ReportPdfKind,
  opts?: { sections?: FinalReportSectionId[]; categories?: ExpenseCategoryId[] },
) {
  const path = reportPdfPath(projectId, kind, opts);
  const partial = kind === 'final' && !!path.includes('?');
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, reportPdfFilename(kind, projectId, partial), 'share');
}

export async function downloadReportPdf(
  userId: string,
  projectId: string,
  kind: ReportPdfKind,
  opts?: { sections?: FinalReportSectionId[]; categories?: ExpenseCategoryId[] },
) {
  const path = reportPdfPath(projectId, kind, opts);
  const partial = kind === 'final' && !!path.includes('?');
  const blob = await fetchPdfBlob(userId, path);
  await openPdfBlob(blob, reportPdfFilename(kind, projectId, partial), 'download');
}
