import { reportError, reportCatch } from '@/lib/reportError';
/** Документы проекта — по разделам + единый индекс Document Center */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { api, ApiError, type ProjectDocument, type ProjectDocumentsResponse } from '@/lib/api';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { pollDocumentSignature } from '@/lib/esignPoll';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';
import { apiErrorMessage } from '@/lib/formatPhone';
import {
  documentCenterSubtitle,
  isCanonicalDocument,
} from '@/lib/documentCenterMeta';
import { pickDocumentForUpload, pickImageForDocumentUpload } from '@/lib/documentUploadPick';
import { isOfflineQueued, notifyOfflineBlocked, notifyOfflineQueued } from '@/lib/offlineUi';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, calendarTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';
import { documentSectionTarget } from '@/lib/documentSectionNav';
import { shareRenovaLink } from '@/lib/messengerShare';
import { BankStatementImportSheet } from '@/components/renova/BankStatementImportSheet';
import { alertIcalExported } from '@/lib/calendarIcsNav';
import { alertWarrantyClosed, alertWarrantyCreated } from '@/lib/warrantyNav';
import { resolveSafeDocumentUrl } from '@/lib/documentUrl';
import { openQcIssue } from '@/lib/qcNav';
import { alertCloseoutDone, alertDocumentSigned } from '@/lib/scheduleCloseoutNav';
import { alertDocumentOcrDone } from '@/lib/fieldCommsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';

type DocRow = {
  id: string;
  label: string;
  desc: string;
  format: string;
  previewPath?: string;
  filename?: string;
  run?: () => Promise<void>;
  /** PDF — по нажатию меню: открыть / скачать / поделиться */
  pdf?: boolean;
};

type DocSection = {
  title: string;
  hint?: string;
  rows: DocRow[];
};

function sourceLabel(source: string) {
  switch (source) {
    case 'design': return 'Дизайн';
    case 'receipt': return 'Чек';
    case 'acceptance': return 'Приёмка';
    case 'canonical': return 'Документ';
    case 'export': return 'Экспорт';
    default: return source;
  }
}

function statusLabel(doc: ProjectDocument) {
  if (doc.source === 'receipt') return doc.verified ? 'Проверен' : 'Не проверен';
  if (doc.status === 'ready') return 'Готов';
  if (doc.status === 'verified') return 'Проверен';
  if (doc.status === 'unverified') return 'Не проверен';
  return doc.status || '—';
}

function formatDocMeta(doc: ProjectDocument) {
  const parts = [sourceLabel(doc.source), statusLabel(doc)];
  if (doc.version != null) parts.push(`v${doc.version}`);
  if (doc.amount != null) parts.push(formatRub(doc.amount));
  return documentCenterSubtitle(doc, parts.filter(Boolean) as string[]);
}

function indexedFilename(doc: ProjectDocument) {
  if (doc.kind === 'stage_acceptance_act') return `acceptance-${String(doc.meta?.stage_id || doc.id).slice(0, 8)}.pdf`;
  if (doc.kind.includes('estimate')) return doc.kind.endsWith('xlsx') ? 'estimate.xlsx' : doc.kind.endsWith('csv') ? 'estimate.csv' : 'estimate.pdf';
  if (doc.kind.includes('dossier')) return 'project-dossier.pdf';
  if (doc.kind.includes('project')) return 'project-report.pdf';
  return `${doc.kind || 'document'}.pdf`;
}

export function DocumentsHub({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
  projectName?: string;
}) {
  const { user, activeProject, loadProject } = useRenova();
  const isContractor = user?.role === 'contractor';
  const isArchived = Boolean(activeProject?.is_archived);
  const [busy, setBusy] = useState<string | null>(null);
  const [bankImportOpen, setBankImportOpen] = useState(false);

  const [docIndex, setDocIndex] = useState<ProjectDocumentsResponse | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [konturAvailable, setKonturAvailable] = useState(false);
  const [konturMode, setKonturMode] = useState<'off' | 'sandbox' | 'live' | string>('off');
  // OCR в Document Center — локальная heuristic-классификация, не remote ML demo.
  const ocrModeLabel = 'LOCAL';
  const contextRef = useRef({ userId: user?.id ?? null, projectId: activeProject?.id ?? null });
  contextRef.current = { userId: user?.id ?? null, projectId: activeProject?.id ?? null };

  const reconcileProjectAfterCommit = useCallback(async (action: string) => {
    const current = contextRef.current;
    if (current.userId !== userId || current.projectId !== projectId) {
      reportError(
        'DocumentsHub.ContextChangedAfterCommit',
        new Error('active documents context changed after committed mutation'),
        { action, projectId, currentProjectId: current.projectId },
      );
      return;
    }
    try {
      await loadProject(projectId);
    } catch (error) {
      reportError(`DocumentsHub.${action}.ProjectRefresh`, error, { projectId });
    }
  }, [loadProject, projectId, userId]);

  const pdfPath = (path: string) => path.replace('{id}', projectId);

  useEffect(() => {
    let alive = true;
    setIndexLoading(true);
    api.listProjectDocuments(userId, projectId)
      .then((result) => { if (alive) setDocIndex(result); })
      .catch((e) => {
        reportError('docs.list', e, { projectId });
        if (alive) setDocIndex(null);
      })
      .finally(() => { if (alive) setIndexLoading(false); });
    api.listEsignProviders(userId)
      .then(({ providers }) => {
        if (!alive) return;
        const k = providers.find((p) => p.name === 'kontur');
        setKonturAvailable(Boolean(k?.available));
        const mode = String((k as { mode?: string } | undefined)?.mode || (k?.available ? 'sandbox' : 'off'));
        setKonturMode(mode);
      })
      .catch((e) => {
        reportError('docs.esignProviders', e);
        if (alive) { setKonturAvailable(false); setKonturMode('off'); }
      });
    api.getEsignHealth(userId)
      .then((h: any) => {
        if (!alive) return;
        const km = h?.kontur_mode || h?.integrations?.esign?.kontur_mode;
        if (km) setKonturMode(String(km));
      })
      .catch(reportCatch('docs.esignHealth'));
    return () => { alive = false; };
  }, [userId, projectId]);

  const reloadIndex = useCallback(() => {
    setIndexLoading(true);
    return api.listProjectDocuments(userId, projectId)
      .then((result) => setDocIndex(result))
      .catch((e) => { reportError('components.renova.DocumentsHub.DocIndex', e); setDocIndex(null); })
      .finally(() => setIndexLoading(false));
  }, [userId, projectId]);

  // W94: после приёмки/подписи/оплаты — индекс документов без remount
  useProjectDataReload(reloadIndex);

  const recentDocs = useMemo(() => (docIndex?.items || []).slice(0, 8), [docIndex]);
  /** Clarity D: черновики ждут подписи — pinned сверху */
  const needsSignDocs = useMemo(
    () => (docIndex?.items || []).filter((d) => d.status === 'draft'),
    [docIndex],
  );
  /** Clarity D: секции свёрнуты по умолчанию — меньше шума */
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const sections: DocSection[] = useMemo(() => {
    const rows = {
      estimatePdf: {
        id: 'estimate',
        label: 'Смета проекта',
        desc: 'План работ и суммы по комнатам',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/estimate.pdf'),
        filename: 'estimate.pdf',
        run: () => api.downloadEstimatePdf(userId, projectId),
      },
      projectPdf: {
        id: 'project',
        label: 'Отчёт по объекту',
        desc: 'Прогресс, сроки и бюджет',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/export.pdf'),
        filename: 'project-report.pdf',
        run: () => api.exportProjectPdf(userId, projectId),
      },
      expensesCsv: {
        id: 'expcsv',
        label: 'Расходы',
        desc: 'План и факт — для учёта и Excel',
        format: 'CSV',
        run: () => api.exportExpensesCsv(userId, projectId),
      },
      onecCsv: {
        id: 'onec',
        label: 'Выгрузка в 1С (CSV)',
        desc: 'Файл-заготовка для импорта в 1С (не live-синк)',
        format: 'CSV',
        run: () => api.export1cPaymentsCsv(userId, projectId),
      },
      onecXml: {
        id: 'onec-xml',
        label: 'Выгрузка в 1С (XML)',
        desc: 'XML-заготовка RenovaExchange (не live-синк)',
        format: 'XML',
        run: () => api.export1cPaymentsXml(userId, projectId),
      },
      onecCml: {
        id: 'onec-cml',
        label: '1С CommerceML',
        desc: 'CommerceML 2.04 заготовка (не live-синк)',
        format: 'XML',
        run: () => api.export1cCommercemlXml(userId, projectId),
      },
      bankCsv: {
        id: 'bank',
        label: 'Реестр для банка',
        desc: 'CSV для ручной сверки с банком (не API банка)',
        format: 'CSV',
        run: () => api.exportBankRegisterCsv(userId, projectId),
      },
      bankImport: {
        id: 'bank-import',
        label: 'Импорт выписки',
        desc: 'CSV банка → матч → confirm оплат (gate приёмки)',
        format: 'CSV',
        run: async () => {
          setBankImportOpen(true);
        },
      },
      weeklyDigest: {
        id: 'digest',
        label: 'Недельный дайджест',
        desc: 'Push + KPI PDF · rule-based (Ollama опционально)',
        format: 'Push',
        run: async () => {
          const res = await api.pushWeeklyDigest(userId, projectId);
          const modeLabel =
            res.source === 'ollama' ? 'Текст: Ollama' : 'Текст: rule-based (без LLM)';
          const role = (isContractor ? 'contractor' : 'customer') as OsRole;
          // Clarity I: sheet вместо Alert после дайджеста
          showActionConfirm({
            title: 'Дайджест отправлен',
            message: `${modeLabel}\nУведомлений: ${res.notified}\n\n${(res.body || '').slice(0, 220)}`,
            primaryLabel: 'Входящие',
            onPrimary: () => pushOsNav('/inbox', undefined, role),
            secondaryLabel: 'KPI PDF',
            onSecondary: () => {
              void api.exportKpiWeeklyPdf(userId, projectId);
            },
          });
        },
      },
      // W122: Houzz/BT client portal share
      portalShare: {
        id: 'portal',
        label: isContractor ? 'Портал заказчику' : 'Мой клиентский портал',
        desc: 'Magic-link: приёмка · подпись · оплата',
        format: 'Link',
        run: async () => {
          const link = await api.createCustomerPortalLink(userId, projectId, {
            allow_accept_stage: true,
            allow_pay: true,
          });
          // Создание magic-link не изменяет ProjectDetail — project sync здесь не нужен.
          await shareRenovaLink(link.url, 'портал Renova (приёмка · подпись · оплата)');
        },
      },
      warrantyClaim: {
        id: 'warranty',
        label: isArchived ? 'Гарантия после сдачи' : 'Гарантийное обращение',
        desc: isArchived
          ? (isContractor ? 'Post-closeout тикет → QC (SLA 14 дней)' : 'После сдачи объекта — SLA 14 дней')
          : isContractor
            ? 'Тикет → QC исполнителя'
            : 'Создать / закрыть открытые (нужно для closeout)',
        format: isArchived ? 'Post-closeout' : 'Заявка',
        run: async () => {
          const role = (isContractor ? 'contractor' : 'customer') as OsRole;
          const open = await api.listWarrantyClaims(userId, projectId).catch((error) => {
            reportError('DocumentsHub.WarrantyDecisionRead', error, { projectId });
            throw error;
          });
          const openItems = (open.items || []).filter((i) => i.status !== 'closed');
          // W64/W126: заказчик закрывает гарантию — иначе closeout тупик; обе роли → QC
          if (!isContractor && openItems.length > 0) {
            const first = openItems[0];
            showActionConfirm({
              title: 'Открытые гарантии',
              message: `Открыто: ${openItems.length}. «${first.title || 'Обращение'}» — закрыть?`,
              actions: [
                {
                  label: 'В QC',
                  onPress: () => openQcIssue(first.id, '/documents', role),
                },
                {
                  label: 'Закрыть это',
                  onPress: () => {
                    void withBusy('warranty-close', async () => {
                      await api.closeWarrantyClaim(userId, projectId, first.id);
                      void reconcileProjectAfterCommit('WarrantyClose');
                      alertWarrantyClosed(role);
                    });
                  },
                },
                {
                  label: 'Создать ещё',
                  onPress: () => {
                    void withBusy('warranty-create-extra', async () => {
                      const res = await api.createWarrantyClaim(userId, projectId, {
                        title: 'Гарантийное обращение',
                        description: 'Создано из Document Center',
                      });
                      void reconcileProjectAfterCommit('WarrantyCreate');
                      alertWarrantyCreated(role, res, { openCount: (open.open || 0) + 1, returnTo: '/documents' });
                    });
                  },
                },
              ],
            });
            return;
          }
          const res = await api.createWarrantyClaim(userId, projectId, {
            title: 'Гарантийное обращение',
            description: 'Создано из Document Center',
          });
          void reconcileProjectAfterCommit('WarrantyCreate');
          alertWarrantyCreated(role, res, { openCount: (open.open || 0) + 1, returnTo: '/documents' });
        },
      },
      closeout: {
        id: 'closeout',
        label: 'Завершение объекта',
        desc: isContractor
          ? 'Статус готовности (завершает только заказчик)'
          : 'Чеклист этапов / оплат / гарантии',
        format: 'Closeout',
        run: async () => {
          const snap = await api.closeoutChecklist(userId, projectId);
          if (snap.archived) {
            showActionConfirm({
              title: 'Closeout',
              message: 'Объект уже в архиве',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
            return;
          }
          const body = [
            snap.next_action,
            `Этапы: ${snap.all_stages_done ? 'все сданы' : 'есть открытые'}`,
            `Оплаты pending: ${snap.pending_payments}`,
            `Гарантия open: ${snap.warranty_open}${snap.warranty_overdue ? ` (просрочено: ${snap.warranty_overdue})` : ''}`,
            `Акты: ${snap.acceptance_acts_active}`,
          ].join('\n');
          // W61: исполнитель видит чеклист, архивирует только заказчик
          if (isContractor) {
            showActionConfirm({
              title: 'Готовность объекта',
              message: `${body}\n\nЗавершить объект может только заказчик.`,
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
            return;
          }
          if (!snap.ready) {
            // W65 #12: deep-link на каждый блокер closeout
            const actions: { label: string; onPress: () => void }[] = [];
            if (!snap.all_stages_done) {
              actions.push({
                label: 'К приёмке',
                onPress: () => pushOsNav(repairTabRoute('customer', 'control'), undefined, 'customer'),
              });
            }
            if ((snap.pending_payments || 0) > 0) {
              actions.push({
                label: 'К оплатам',
                onPress: () => pushOsNav(budgetTabRoute('customer', 'payments'), undefined, 'customer'),
              });
            }
            if ((snap.acceptance_acts_active || 0) === 0 && snap.all_stages_done) {
              actions.push({
                label: 'К документам',
                onPress: () => pushOsNav('/documents', undefined, 'customer'),
              });
            }
            if ((snap.warranty_open || 0) > 0) {
              actions.push({
                label: 'К гарантии',
                onPress: () => { void rows.warrantyClaim.run?.(); },
              });
            }
            showActionConfirm({
              title: 'Ещё не готово',
              message: body,
              ...(actions.length
                ? { actions }
                : { primaryLabel: 'Понятно', onPrimary: () => undefined }),
            });
            return;
          }
          showActionConfirm({
            title: 'Завершить объект?',
            message: body,
            primaryLabel: 'Завершить',
            onPrimary: () => {
              void (async () => {
                try {
                  const res = await api.closeoutProject(userId, projectId);
                  void reconcileProjectAfterCommit('Closeout');
                  alertCloseoutDone('customer', res.next_action);
                } catch (e: unknown) {
                  Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось завершить');
                }
              })();
            },
            secondaryLabel: 'Отмена',
            onSecondary: () => undefined,
          });
        },
      },
      activityPdf: {
        id: 'activity',
        label: 'Архив ремонта',
        desc: 'Журнал событий по объекту',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/activity-dossier.pdf'),
        filename: 'activity.pdf',
        run: () => api.exportActivityDossier(userId, projectId),
      },
      calendarIcs: {
        id: 'ical',
        label: 'Календарь работ',
        desc: 'ICS-файл (импорт вручную; не live-синк Google/Apple)',
        format: 'ICS',
        // W124: native Share + CTA на график SoT
        run: async () => {
          await api.exportIcal(userId, projectId);
          const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
          alertIcalExported(role);
        },
      },
      estimateTable: {
        id: 'estimate-table',
        label: 'Смета для Excel',
        desc: 'Выберите формат CSV или XLSX',
        format: 'CSV / Excel',
      },
      dossierPdf: {
        id: 'dossier',
        label: 'Полное досье',
        desc: 'Смета, финансы, этапы и архив в одном файле',
        format: 'PDF',
        pdf: true,
        previewPath: pdfPath('/api/v1/projects/{id}/full-dossier.pdf'),
        filename: 'full-dossier.pdf',
        run: () => api.exportFullDossier(userId, projectId),
      },
      gdpr: {
        id: 'gdpr',
        label: 'Мои данные',
        desc: 'Экспорт профиля и списка проектов',
        format: 'JSON',
        run: async () => {
          const data = await api.exportMyData(userId);
          await exportGdprJsonFile(data, 'renova-export.json');
        },
      },
    } satisfies Record<string, DocRow>;

    return [
      {
        title: 'Главное',
        hint: 'То, что чаще всего нужно заказчику',
        rows: [rows.estimatePdf, rows.projectPdf, rows.expensesCsv, rows.portalShare],
      },
      {
        title: 'Учёт RU',
        hint: 'W67: 1С/банк — файлы для ручного импорта, не live API',
        rows: [rows.onecCsv, rows.onecXml, rows.onecCml, rows.bankCsv, rows.bankImport, rows.weeklyDigest, rows.warrantyClaim, rows.closeout],
      },
      {
        title: 'Архив и сроки',
        rows: [rows.activityPdf, rows.calendarIcs],
      },
      {
        title: 'Таблицы',
        rows: [rows.estimateTable],
      },
      {
        title: 'Дополнительно',
        rows: [rows.dossierPdf, rows.gdpr],
      },
    ];
  }, [userId, projectId, user?.role, isArchived, reconcileProjectAfterCommit]);

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Документы');
        return;
      }
      const msg = apiErrorMessage(e, '');
      const providerDown =
        (e instanceof ApiError && e.status === 501) ||
        msg.includes('501') ||
        msg.includes('provider_unavailable');
      Alert.alert(
        'Ошибка',
        providerDown
          ? 'Провайдер подписи пока недоступен. Используйте «Подписать в приложении» или повторите позже.'
          : (msg.slice(0, 180) || 'Не удалось выполнить действие. Проверьте связь с API.'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf(row: DocRow) {
    if (!row.previewPath || !row.filename) return;
    const blob = await fetchPdfBlob(userId, row.previewPath);
    await openPdfBlob(blob, row.filename, 'share');
  }

  function openPdfMenu(row: DocRow) {
    if (!row.run) return;
    const actions = [
      {
        label: 'Открыть',
        onPress: () => {
          if (!row.previewPath || !row.filename) return;
          withBusy(`${row.id}-open`, () => previewProjectPdf(userId, row.previewPath!, row.filename!));
        },
      },
      {
        label: 'Скачать',
        onPress: () => withBusy(`${row.id}-dl`, row.run!),
      },
    ];
    if (Platform.OS !== 'web') {
      actions.push({
        label: 'Поделиться',
        onPress: () => withBusy(`${row.id}-share`, () => sharePdf(row)),
      });
    }
    showActionConfirm({
      title: row.label,
      message: row.desc,
      actions,
    });
  }

  function openEstimateTableMenu() {
    // Clarity K: sheet вместо Alert-меню формата
    showActionConfirm({
      title: 'Смета для Excel',
      message: 'Выберите формат файла',
      primaryLabel: 'Excel (XLSX)',
      onPrimary: () => {
        void withBusy('xlsx', () => api.exportEstimateXlsx(userId, projectId));
      },
      secondaryLabel: 'CSV',
      onSecondary: () => {
        void withBusy('csv', () => api.exportEstimateCsv(userId, projectId));
      },
    });
  }

  function onRowPress(row: DocRow) {
    if (row.id === 'estimate-table') {
      openEstimateTableMenu();
      return;
    }
    if (row.pdf) {
      openPdfMenu(row);
      return;
    }
    if (row.run) withBusy(row.id, row.run);
  }

  function openIndexedDocument(doc: ProjectDocument) {
    const openFile = () => {
      if (!doc.href) {
        showActionConfirm({
          title: doc.title,
          message: 'Файл ещё не загружен. Добавьте документ через «+ Файл» или дождитесь генерации акта.',
          primaryLabel: 'Загрузить',
          onPrimary: () => { void uploadCanonicalDocument(); },
          secondaryLabel: 'Позже',
          onSecondary: () => undefined,
        });
        return;
      }
      if (doc.href.toLowerCase().includes('.pdf') || doc.href.includes('/media/')) {
        withBusy(`index-${doc.id}`, () => previewProjectPdf(userId, doc.href!, indexedFilename(doc)));
        return;
      }
      // Investor P2: sheet + deep-link в канон раздела
      const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
      const section = documentSectionTarget(role, doc);
      showActionConfirm({
        title: doc.title,
        message: formatDocMeta(doc),
        actions: [
          {
            label: 'Открыть',
            onPress: () => {
              const safeHref = resolveSafeDocumentUrl(doc.href);
              if (!safeHref) {
                showActionConfirm({
                  title: 'Ссылка недоступна',
                  message: 'Документ содержит небезопасный или пустой адрес.',
                  primaryLabel: section.label,
                  onPrimary: () => pushOsNav(section.route, undefined, role),
                  secondaryLabel: 'Позже',
                  onSecondary: () => undefined,
                });
                return;
              }
              void Linking.openURL(safeHref).catch(() => {
                showActionConfirm({
                  title: 'Не удалось открыть',
                  message: 'Скопируйте ссылку или перейдите в раздел документа.',
                  primaryLabel: section.label,
                  onPrimary: () => pushOsNav(section.route, undefined, role),
                  secondaryLabel: 'Позже',
                  onSecondary: () => undefined,
                });
              });
            },
          },
          {
            label: section.label,
            onPress: () => pushOsNav(section.route, undefined, role),
          },
        ],
      });
    };

    if (!isCanonicalDocument(doc)) {
      openFile();
      return;
    }

    // Wave 3d: действия Document Center для канонических документов
    const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
    const section = documentSectionTarget(role, doc);
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      { text: 'Открыть', onPress: openFile },
      {
        text: section.label,
        onPress: () => pushOsNav(section.route, undefined, role),
      },
      {
        text: 'Подписать в приложении',
        onPress: () => withBusy(`sign-${doc.id}`, async () => {
          await api.signProjectDocument(userId, projectId, doc.id, { provider: 'in_app' });
          await reloadIndex();
          void reconcileProjectAfterCommit('SignInApp');
          // W132: подпись → документы / график
          alertDocumentSigned(role, 'in_app');
        }),
      },
      ...(konturAvailable ? [{
        text: 'Подписать через Контур',
        onPress: () => withBusy(`sign-kontur-${doc.id}`, async () => {
          const signed = await api.signProjectDocument(userId, projectId, doc.id, { provider: 'kontur' }) as {
            signing_url?: string | null;
            external_id?: string | null;
            status?: string;
          };
          if (signed?.signing_url) {
            await WebBrowser.openBrowserAsync(signed.signing_url);
          }
          const status = await pollDocumentSignature(userId, projectId, doc.id, { provider: 'kontur' });
          await reloadIndex();
          void reconcileProjectAfterCommit('SignKontur');
          if (status === 'signed') {
            alertDocumentSigned(role, 'kontur');
          } else if (status === 'failed') {
            showActionConfirm({
              title: 'Контур',
              message: 'Подпись не завершена. Проверьте статус позже или подпишите в приложении.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } else {
            showActionConfirm({
              title: 'Контур',
              message: signed?.signing_url
                ? 'Подпишите в браузере Контура. Статус обновится по webhook.'
                : 'Запрос создан (pending). Статус обновится по webhook или при следующем открытии документов.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          }
        }),
      }] : []),
      {
        text: 'Распознать тип (OCR)',
        onPress: () => withBusy(`ocr-${doc.id}`, async () => {
          await api.runDocumentOcr(userId, projectId, doc.id, true);
          await reloadIndex();
          void reconcileProjectAfterCommit('Ocr');
          alertDocumentOcrDone(role);
        }),
      },
      {
        text: doc.meta?.legal_hold ? 'Снять legal hold' : 'Legal hold',
        onPress: () => withBusy(`hold-${doc.id}`, async () => {
          await api.setDocumentLegalHold(userId, projectId, doc.id, !doc.meta?.legal_hold);
          await reloadIndex();
        }),
      },
      {
        text: 'Архив',
        onPress: () => withBusy(`arch-${doc.id}`, async () => {
          await api.archiveProjectDocument(userId, projectId, doc.id);
          await reloadIndex();
        }),
      },
    ];
    showActionConfirm({
      title: doc.title,
      message: formatDocMeta(doc),
      actions: actions.map((a) => ({ label: a.text, onPress: () => { a.onPress?.(); } })),
    });
  }

  async function doUploadPicked(file: { uri: string; name: string; type: string }) {
    await withBusy('upload', async () => {
      await api.uploadProjectDocument(
        userId,
        projectId,
        file,
        { title: file.name, document_type: 'upload' },
      );
      await reloadIndex();
      void reconcileProjectAfterCommit('Upload');
    });
  }

  /** Wave 3e: web file input + native DocumentPicker / photo fallback */
  async function uploadCanonicalDocument() {
    try {
      if (Platform.OS === 'web') {
        const file = await pickDocumentForUpload();
        if (!file) return;
        await doUploadPicked(file);
        return;
      }

      showActionConfirm({
        title: 'Загрузить документ',
        message: 'Выберите источник файла',
        actions: [
          {
            label: 'Файл (PDF, DOC…)',
            onPress: () => {
              void (async () => {
                try {
                  const file = await pickDocumentForUpload();
                  if (!file) return;
                  await doUploadPicked(file);
                } catch (e: any) {
                  Alert.alert('Ошибка загрузки', String(e?.message || e));
                }
              })();
            },
          },
          {
            label: 'Фото из галереи',
            onPress: () => {
              void (async () => {
                try {
                  const file = await pickImageForDocumentUpload();
                  if (!file) return;
                  await doUploadPicked(file);
                } catch (e: any) {
                  Alert.alert('Ошибка загрузки', String(e?.message || e));
                }
              })();
            },
          },
        ],
      });
    } catch (e: any) {
      Alert.alert('Ошибка загрузки', String(e?.message || e));
    }
  }


  return (
    <>
      <BankStatementImportSheet
        visible={bankImportOpen}
        onClose={() => setBankImportOpen(false)}
        userId={userId}
        projectId={projectId}
        role={user?.role === 'contractor' ? 'contractor' : 'customer'}
        onDone={() => {
          void reconcileProjectAfterCommit('BankImport');
        }}
      />
    <View style={s.wrap}>
      <Text style={s.sub}>Сначала подпишите черновики — остальные разделы ниже по запросу</Text>
      <OfflineSyncStatus compact />

      {needsSignDocs.length > 0 ? (
        <View style={s.signPin} accessibilityLabel={`Нужно подписать ${needsSignDocs.length}`}>
          <Text style={s.signPinTitle}>Нужно подписать ({needsSignDocs.length})</Text>
          <Text style={s.signPinHint}>Откройте документ и выберите «Подписать в приложении»</Text>
          {needsSignDocs.map((doc) => {
            const loading = busy === `index-${doc.id}` || busy?.startsWith(`sign-${doc.id}`);
            return (
              <Pressable
                key={doc.id}
                style={({ pressed }: { pressed: boolean }) => [s.recentRow, pressed && s.rowPressed]}
                onPress={() => openIndexedDocument(doc)}
                disabled={Boolean(busy)}
                accessibilityRole="button"
                accessibilityLabel={`Подписать: ${doc.title}`}
              >
                <View style={s.recentMain}>
                  <Text style={s.recentTitle} numberOfLines={1}>{doc.title}</Text>
                  <Text style={s.recentMeta} numberOfLines={1}>{formatDocMeta(doc)}</Text>
                </View>
                {loading ? (
                  <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                ) : (
                  <Ionicons name="create-outline" size={18} color={RenovaTheme.colors.primary} />
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={s.modeRow} accessibilityLabel="Режимы интеграций документов">
        <Text style={[s.modeChip, s.modeWarn]}>OCR: {ocrModeLabel}</Text>
        <Text style={[s.modeChip, konturMode === 'live' ? s.modeOk : s.modeWarn]}>
          Kontur: {(konturMode || 'off').toUpperCase()}{konturAvailable ? '' : ' · UNAVAILABLE'}
        </Text>
        <Text style={[s.modeChip, s.modeWarn]}>Подпись: {konturAvailable ? 'PROVIDER' : 'IN_APP / LOCAL'}</Text>
      </View>

      <View style={s.indexCard}>
        <View style={s.indexHeader}>
          <View>
            <Text style={s.indexTitle}>Единый индекс</Text>
            <Text style={s.indexHint}>Дизайн, чеки, акты, OCR и подпись — в одном месте</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            {indexLoading ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : null}
            <Pressable
              onPress={() => { void uploadCanonicalDocument(); }}
              disabled={Boolean(busy)}
              style={s.uploadBtn}
              accessibilityRole="button"
              accessibilityLabel="Загрузить документ"
            >
              <Text style={s.uploadBtnText}>{busy === 'upload' ? '…' : '+ Файл'}</Text>
            </Pressable>
          </View>
        </View>
        {docIndex ? (
          <View style={s.countsRow}>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.design}</Text><Text style={s.countLabel}>дизайн</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.acceptances ?? 0}</Text><Text style={s.countLabel}>акты</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.receipts}</Text><Text style={s.countLabel}>чеки</Text></View>
            <View style={s.countPill}><Text style={s.countValue}>{docIndex.counts.exports}</Text><Text style={s.countLabel}>экспорт</Text></View>
          </View>
        ) : (
          <Text style={s.indexEmpty}>Индекс пока недоступен. Базовые документы ниже остаются рабочими.</Text>
        )}
        {recentDocs.length ? (
          <View style={s.recentList}>
            {recentDocs.map((doc) => {
              const loading = busy === `index-${doc.id}`;
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }: { pressed: boolean }) => [s.recentRow, pressed && s.rowPressed]}
                  onPress={() => openIndexedDocument(doc)}
                  disabled={Boolean(busy)}
                  accessibilityRole="button"
                  accessibilityLabel={`${doc.title}. ${formatDocMeta(doc)}`}
                >
                  <View style={s.recentMain}>
                    <Text style={s.recentTitle} numberOfLines={1}>{doc.title}</Text>
                    <Text style={s.recentMeta} numberOfLines={1}>{formatDocMeta(doc)}</Text>
                  </View>
                  {loading ? (
                    <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                  ) : (
                    <Ionicons
                      name={doc.href ? 'chevron-forward' : 'information-circle-outline'}
                      size={18}
                      color={RenovaTheme.colors.textMuted}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {sections.map((section) => {
        const open = Boolean(expandedSections[section.title]);
        return (
          <View key={section.title} style={s.section}>
            <Pressable
              style={s.sectionHeader}
              onPress={() =>
                setExpandedSections((prev) => ({ ...prev, [section.title]: !prev[section.title] }))
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${section.title}, ${open ? 'свернуть' : 'развернуть'}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>{section.title}</Text>
                {!open && section.hint ? (
                  <Text style={s.sectionHint} numberOfLines={1}>{section.hint}</Text>
                ) : null}
              </View>
              <Text style={s.sectionCount}>{section.rows.length}</Text>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={RenovaTheme.colors.textMuted}
              />
            </Pressable>
            {open ? (
              <>
                {section.hint ? <Text style={s.sectionHint}>{section.hint}</Text> : null}
                {section.rows.map((row) => {
                  const loading = busy === row.id || busy?.startsWith(`${row.id}-`);
                  return (
                    <Pressable
                      key={row.id}
                      style={({ pressed }: { pressed: boolean }) => [s.row, pressed && s.rowPressed]}
                      onPress={() => onRowPress(row)}
                      disabled={!!busy}
                      accessibilityRole="button"
                    >
                      <View style={s.rowMain}>
                        <Text style={s.label}>{row.label}</Text>
                        <Text style={s.desc}>{row.desc}</Text>
                      </View>
                      <View style={s.rowTail}>
                        <Text style={s.format}>{row.format}</Text>
                        {loading ? (
                          <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.textMuted} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </>
            ) : null}
          </View>
        );
      })}
    </View>
    </>
  );
}

const s = StyleSheet.create({
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  modeChip: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  modeOk: { backgroundColor: 'rgba(34,140,80,0.14)', color: RenovaTheme.colors.textMuted },
  modeWarn: { backgroundColor: 'rgba(160,120,40,0.14)', color: RenovaTheme.colors.textMuted },

  wrap: { paddingHorizontal: 16, paddingBottom: 24 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 16, lineHeight: 18 },
  // Clarity W: index без Theme.card / 800
  indexCard: { marginBottom: 18, gap: 10 },
  indexHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  indexTitle: { ...screenTypography.listTitle, fontSize: 16 },
  uploadBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: RenovaTheme.colors.primary },
  uploadBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  indexHint: { ...screenTypography.listMeta, marginTop: 3 },
  indexEmpty: { ...screenTypography.empty },
  countsRow: { ...listRowStyles.summaryRow, flexWrap: 'wrap' },
  countPill: { ...listRowStyles.metricCell, flexGrow: 1, minWidth: '22%' },
  countValue: { ...screenTypography.metric, fontSize: 16 },
  countLabel: { ...screenTypography.metricLabel },
  recentList: { gap: 6 },
  recentRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RenovaTheme.colors.border, paddingTop: 10, paddingBottom: 4 },
  recentMain: { flex: 1, minWidth: 0 },
  recentTitle: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  recentMeta: { marginTop: 2, fontSize: 11, color: RenovaTheme.colors.textMuted },
  signPin: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.primary,
    backgroundColor: RenovaTheme.colors.surface,
    gap: 6,
  },
  signPinTitle: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  signPinHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 4, lineHeight: 16 },
  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
  },
  sectionTitle: {
    ...screenTypography.section,
    marginBottom: 0,
    marginTop: 0,
  },
  sectionCount: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  sectionHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, marginTop: 6, lineHeight: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 2,
    marginBottom: 0,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    backgroundColor: 'transparent',
  },
  rowPressed: { opacity: 0.85, backgroundColor: RenovaTheme.colors.infoBg },
  rowMain: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 3, lineHeight: 16 },
  rowTail: { alignItems: 'flex-end', gap: 4, minWidth: 56 },
  format: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.primary, textTransform: 'uppercase' },

});