import { reportError, reportCatch } from '@/lib/reportError';
/** Документы проекта — по разделам + единый индекс Document Center */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api, ApiError, type ProjectDocument, type ProjectDocumentsResponse } from '@/lib/api';
import { fetchPdfBlob, openPdfBlob, previewProjectPdf } from '@/lib/pdfOpen';
import { pollDocumentSignature } from '@/lib/esignPoll';
import { exportGdprJsonFile } from '@/lib/exportGdprJson';
import { apiErrorMessage } from '@/lib/formatPhone';
import {
  documentCenterSubtitle,
  isCanonicalDocument,
} from '@/lib/documentCenterMeta';
import {
  capabilityModeLabel,
  normalizeCapability,
  type ServiceCapability,
} from '@/lib/api/types/capabilities';
import { pickDocumentForUpload, pickImageForDocumentUpload } from '@/lib/documentUploadPick';
import { isOfflineQueued, notifyOfflineBlocked, notifyOfflineQueued } from '@/lib/offlineUi';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, calendarTabRoute, repairTabRoute, type OsRole } from '@/constants/osSections';
import { shareRenovaLink } from '@/lib/messengerShare';
import { BankStatementImportSheet } from '@/components/renova/BankStatementImportSheet';
import { alertIcalExported } from '@/lib/calendarIcsNav';
import { alertWarrantyClosed, alertWarrantyCreated, alertWarrantyConflict } from '@/lib/warrantyNav';
import { beginWarrantyCreate, clearWarrantyCreateSession, warrantyCreateKeyForRetry } from '@/lib/warrantyCreateSession';
import { openQcIssue } from '@/lib/qcNav';
import { alertCloseoutDone, alertDocumentSigned } from '@/lib/scheduleCloseoutNav';
import { alertDocumentOcrDone } from '@/lib/fieldCommsNav';

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

function formatDocMeta(doc: ProjectDocument, ocrMode?: string | null) {
  const parts = [sourceLabel(doc.source), statusLabel(doc)];
  if (doc.version != null) parts.push(`v${doc.version}`);
  if (doc.amount != null) parts.push(formatRub(doc.amount));
  return documentCenterSubtitle(doc, parts.filter(Boolean) as string[], ocrMode);
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
  const { user, activeProject } = useRenova();
  const isContractor = user?.role === 'contractor';
  const isArchived = Boolean(activeProject?.is_archived);
  const [busy, setBusy] = useState<string | null>(null);
  const [bankImportOpen, setBankImportOpen] = useState(false);

  const [docIndex, setDocIndex] = useState<ProjectDocumentsResponse | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [konturAvailable, setKonturAvailable] = useState(false);
  const [konturMode, setKonturMode] = useState<'off' | 'sandbox' | 'live' | string>('off');
  const [ocrCap, setOcrCap] = useState<ServiceCapability | null>(null);
  const [ocrHealthError, setOcrHealthError] = useState<string | null>(null);
  const [ocrHealthLoading, setOcrHealthLoading] = useState(false);


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
    const loadOcrHealth = () => {
      setOcrHealthLoading(true);
      api.getOcrHealth(userId)
        .then((h) => {
          if (!alive) return;
          setOcrCap(normalizeCapability(h));
          setOcrHealthError(null);
        })
        .catch((e) => {
          reportError('docs.ocrHealth', e);
          if (!alive) return;
          setOcrCap(normalizeCapability({
            available: false,
            mode: 'error',
            configured: false,
            healthy: false,
            message: 'Не удалось проверить OCR',
          }));
          setOcrHealthError(e instanceof Error ? e.message : 'OCR health error');
        })
        .finally(() => { if (alive) setOcrHealthLoading(false); });
    };
    loadOcrHealth();
    return () => { alive = false; };
  }, [userId, projectId]);

  const reloadOcrHealth = useCallback(() => {
    setOcrHealthLoading(true);
    api.getOcrHealth(userId)
      .then((h) => {
        setOcrCap(normalizeCapability(h));
        setOcrHealthError(null);
      })
      .catch((e) => {
        reportError('docs.ocrHealth.retry', e);
        setOcrCap(normalizeCapability({
          available: false,
          mode: 'error',
          configured: false,
          healthy: false,
          message: 'Не удалось проверить OCR',
        }));
        setOcrHealthError(e instanceof Error ? e.message : 'OCR health error');
      })
      .finally(() => setOcrHealthLoading(false));
  }, [userId]);

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
          Alert.alert(
            'Дайджест отправлен',
            `${modeLabel}
Уведомлений: ${res.notified}

${(res.body || '').slice(0, 220)}`,
            [
              { text: 'OK', style: 'cancel' },
              {
                text: 'KPI PDF',
                onPress: () => {
                  void api.exportKpiWeeklyPdf(userId, projectId);
                },
              },
              {
                // W126: дайджест → inbox (аналог weekly summary)
                text: 'Входящие',
                onPress: () => pushOsNav('/inbox', undefined, isContractor ? 'contractor' : 'customer'),
              },
            ],
          );
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
          await syncProjectSideEffects({
            user: user ?? ({ id: userId } as any),
            project: { id: projectId } as any,
            role: isContractor ? 'contractor' : 'customer',
          });
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
          // Fail-closed: ошибка списка ≠ «обращений нет»
          let open: { open: number; items: { id: string; title?: string; status?: string }[] };
          try {
            open = await api.listWarrantyClaims(userId, projectId);
          } catch (e: unknown) {
            Alert.alert(
              'Не удалось загрузить гарантии',
              (e instanceof Error ? e.message : 'Ошибка сети')
                + '\n\nСоздание отключено, пока список не загрузится. Нажмите действие ещё раз, чтобы повторить.',
            );
            return;
          }
          const openItems = (open.items || []).filter((i) => i.status !== 'closed');

          const createOne = async (reuseKey: boolean) => {
            const key = reuseKey ? warrantyCreateKeyForRetry() : beginWarrantyCreate();
            try {
              const res = await api.createWarrantyClaim(
                userId,
                projectId,
                {
                  title: 'Гарантийное обращение',
                  description: 'Создано из Document Center',
                  client_request_id: key,
                },
                { idempotencyKey: key },
              );
              clearWarrantyCreateSession();
              void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
              if (res.duplicate_hint) {
                Alert.alert('Внимание', res.duplicate_hint);
              }
              alertWarrantyCreated(role, res, { openCount: (open.open || 0) + 1, returnTo: '/documents' });
            } catch (e: unknown) {
              if (e instanceof ApiError && (e.status === 409 || e.code === 'warranty_claim_idempotency_conflict')) {
                alertWarrantyConflict(e.message);
                return;
              }
              // Timeout/сеть: не очищаем key — retry использует тот же
              Alert.alert(
                'Не удалось создать',
                e instanceof Error ? e.message : 'Ошибка сети',
                [
                  { text: 'Отмена', style: 'cancel', onPress: () => clearWarrantyCreateSession() },
                  { text: 'Повторить', onPress: () => { void createOne(true); } },
                ],
              );
            }
          };

          // W64/W126: заказчик закрывает гарантию — иначе closeout тупик; обе роли → QC
          if (!isContractor && openItems.length > 0) {
            const first = openItems[0];
            Alert.alert(
              'Открытые гарантии',
              `Открыто: ${openItems.length}. «${first.title || 'Обращение'}» — закрыть?`,
              [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'В QC',
                  onPress: () => openQcIssue(first.id, '/documents', role),
                },
                {
                  text: 'Закрыть это',
                  onPress: async () => {
                    try {
                      await api.closeWarrantyClaim(userId, projectId, first.id);
                      void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
                      alertWarrantyClosed(role);
                    } catch (e: unknown) {
                      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось закрыть');
                    }
                  },
                },
                {
                  text: 'Создать ещё',
                  onPress: () => { void createOne(false); },
                },
              ],
            );
            return;
          }
          await createOne(false);
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
            Alert.alert('Closeout', 'Объект уже в архиве');
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
            Alert.alert('Готовность объекта', `${body}\n\nЗавершить объект может только заказчик.`);
            return;
          }
          if (!snap.ready) {
            // W65 #12: deep-link на каждый блокер closeout
            const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: 'OK' }];
            if (!snap.all_stages_done) {
              buttons.push({
                text: 'К приёмке',
                onPress: () => pushOsNav(repairTabRoute('customer', 'control'), undefined, 'customer'),
              });
            }
            if ((snap.pending_payments || 0) > 0) {
              buttons.push({
                text: 'К оплатам',
                onPress: () => pushOsNav(budgetTabRoute('customer', 'payments'), undefined, 'customer'),
              });
            }
            if ((snap.acceptance_acts_active || 0) === 0 && snap.all_stages_done) {
              buttons.push({
                text: 'К документам',
                onPress: () => pushOsNav('/documents', undefined, 'customer'),
              });
            }
            if ((snap.warranty_open || 0) > 0) {
              buttons.push({
                text: 'К гарантии',
                onPress: () => {
                  void rows.warrantyClaim.run?.();
                },
              });
            }
            Alert.alert('Ещё не готово', body, buttons);
            return;
          }
          Alert.alert('Завершить объект?', body, [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Завершить',
              onPress: async () => {
                try {
                  const res = await api.closeoutProject(userId, projectId);
                  void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
                  // W132: closeout → главная / документы
                  alertCloseoutDone('customer', res.next_action);
                } catch (e: unknown) {
                  Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось завершить');
                }
              },
            },
          ]);
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
  }, [userId, projectId, user?.role]);

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
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      {
        text: 'Открыть',
        onPress: () => {
          if (!row.previewPath || !row.filename) return;
          withBusy(`${row.id}-open`, () => previewProjectPdf(userId, row.previewPath!, row.filename!));
        },
      },
      {
        text: 'Скачать',
        onPress: () => withBusy(`${row.id}-dl`, row.run!),
      },
    ];
    if (Platform.OS !== 'web') {
      actions.push({
        text: 'Поделиться',
        onPress: () => withBusy(`${row.id}-share`, () => sharePdf(row)),
      });
    }
    actions.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(row.label, row.desc, actions);
  }

  function openEstimateTableMenu() {
    Alert.alert('Смета для Excel', 'Выберите формат файла', [
      { text: 'CSV', onPress: () => withBusy('csv', () => api.exportEstimateCsv(userId, projectId)) },
      { text: 'Excel (XLSX)', onPress: () => withBusy('xlsx', () => api.exportEstimateXlsx(userId, projectId)) },
      { text: 'Отмена', style: 'cancel' },
    ]);
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
        Alert.alert(
          doc.title,
          'Файл ещё не загружен. Добавьте документ через «+ Файл» или дождитесь генерации акта.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Загрузить', onPress: () => { void uploadCanonicalDocument(); } },
          ],
        );
        return;
      }
      if (doc.href.toLowerCase().includes('.pdf') || doc.href.includes('/media/')) {
        withBusy(`index-${doc.id}`, () => previewProjectPdf(userId, doc.href!, indexedFilename(doc)));
        return;
      }
      Alert.alert(doc.title, `${formatDocMeta(doc, ocrCap?.mode)}\n\nФайл доступен в разделе проекта.`);
    };

    if (!isCanonicalDocument(doc)) {
      openFile();
      return;
    }

    // Wave 3d: действия Document Center для канонических документов
    const actions: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      { text: 'Открыть', onPress: openFile },
      {
        text: 'Подписать в приложении',
        onPress: () => withBusy(`sign-${doc.id}`, async () => {
          await api.signProjectDocument(userId, projectId, doc.id, { provider: 'in_app' });
          await reloadIndex();
          void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
          // W132: подпись → документы / график
          const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
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
          void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
          if (status === 'signed') {
            const role = (user?.role === 'contractor' ? 'contractor' : 'customer') as OsRole;
            alertDocumentSigned(role, 'kontur');
          } else if (status === 'failed') {
            Alert.alert('Контур', 'Подпись не завершена. Проверьте статус позже.');
          } else {
            Alert.alert(
              'Контур',
              signed?.signing_url
                ? 'Подпишите в браузере Контура. Статус обновится по webhook.'
                : 'Запрос создан (pending). Статус обновится по webhook или при следующем открытии документов.',
            );
          }
        }),
      }] : []),
      ...((ocrCap?.available && ocrCap.run_allowed !== false) ? [{
        text: 'Распознать тип (OCR)',
        onPress: () => withBusy(`ocr-${doc.id}`, async () => {
          await api.runDocumentOcr(userId, projectId, doc.id, true);
          await reloadIndex();
          void syncProjectSideEffects({ user, project: activeProject ?? ({ id: projectId } as any) });
          alertDocumentOcrDone((user?.role === 'customer' ? 'customer' : 'contractor') as OsRole);
        }),
      }] : []),
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
      { text: 'Отмена', style: 'cancel' },
    ];
    Alert.alert(doc.title, formatDocMeta(doc, ocrCap?.mode), actions);
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

      Alert.alert('Загрузить документ', 'Выберите источник файла', [
        {
          text: 'Файл (PDF, DOC…)',
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
          text: 'Фото из галереи',
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
        { text: 'Отмена', style: 'cancel' },
      ]);
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
          void syncProjectSideEffects({
            user: user ?? ({ id: userId } as any),
            project: activeProject ?? ({ id: projectId } as any),
          });
        }}
      />
    <View style={s.wrap}>
      <Text style={s.sub}>Нажмите на документ — откроется меню или сразу загрузка</Text>
      <View style={s.modeRow} accessibilityLabel="Режимы интеграций документов">
        <Pressable onPress={reloadOcrHealth} accessibilityRole="button" accessibilityLabel={`Повторить проверку OCR. Режим ${capabilityModeLabel(ocrCap?.mode)}`}>
          <Text style={[s.modeChip, ocrCap?.available && ['live', 'local', 'sandbox'].includes(ocrCap.mode) ? s.modeOk : s.modeWarn]}>
            OCR: {ocrHealthLoading ? '…' : capabilityModeLabel(ocrCap?.mode)}
            {ocrCap && !ocrCap.available ? ' · UNAVAILABLE' : ''}
          </Text>
        </Pressable>
        <Text style={[s.modeChip, konturMode === 'live' ? s.modeOk : s.modeWarn]}>
          Kontur: {(konturMode || 'off').toUpperCase()}{konturAvailable ? '' : ' · UNAVAILABLE'}
        </Text>
        <Text style={[s.modeChip, s.modeWarn]}>Подпись: {konturAvailable ? 'PROVIDER' : 'IN_APP / LOCAL'}</Text>
      </View>
      {ocrCap && !ocrCap.available ? (
        <Text style={s.ocrHint} accessibilityRole="text">
          {ocrCap.mode === 'off' ? 'OCR не настроен' : (ocrCap.message || ocrHealthError || 'OCR недоступен')}
        </Text>
      ) : null}
      <OfflineSyncStatus compact />

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
                  style={({ pressed }) => [s.recentRow, pressed && s.rowPressed]}
                  onPress={() => openIndexedDocument(doc)}
                  disabled={Boolean(busy)}
                  accessibilityRole="button"
                  accessibilityLabel={`${doc.title}. ${formatDocMeta(doc, ocrCap?.mode)}`}
                >
                  <View style={s.recentMain}>
                    <Text style={s.recentTitle} numberOfLines={1}>{doc.title}</Text>
                    <Text style={s.recentMeta} numberOfLines={1}>{formatDocMeta(doc, ocrCap?.mode)}</Text>
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

      {sections.map((section) => (
        <View key={section.title} style={s.section}>
          <Text style={s.sectionTitle}>{section.title}</Text>
          {section.hint ? <Text style={s.sectionHint}>{section.hint}</Text> : null}
          {section.rows.map((row) => {
            const loading = busy === row.id || busy?.startsWith(`${row.id}-`);
            return (
              <Pressable
                key={row.id}
                style={({ pressed }) => [s.row, pressed && s.rowPressed]}
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
        </View>
      ))}
    </View>
    </>
  );
}

const s = StyleSheet.create({
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  modeChip: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  modeOk: { backgroundColor: 'rgba(34,140,80,0.14)', color: RenovaTheme.colors.textMuted },
  ocrHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8, paddingHorizontal: 4 },
  modeWarn: { backgroundColor: 'rgba(160,120,40,0.14)', color: RenovaTheme.colors.textMuted },

  wrap: { paddingHorizontal: 16, paddingBottom: 24 },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 16, lineHeight: 18 },
  indexCard: { ...card, marginBottom: 18, gap: 10 },
  indexHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  indexTitle: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  uploadBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: RenovaTheme.colors.primary },
  uploadBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  indexHint: { marginTop: 3, fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  indexEmpty: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countPill: { flexGrow: 1, minWidth: '22%', borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 12, paddingVertical: 8, alignItems: 'center', backgroundColor: RenovaTheme.colors.surface },
  countValue: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  countLabel: { fontSize: 10, color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginTop: 2 },
  recentList: { gap: 6 },
  recentRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, paddingTop: 10, paddingBottom: 4 },
  recentMain: { flex: 1, minWidth: 0 },
  recentTitle: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  recentMeta: { marginTop: 2, fontSize: 11, color: RenovaTheme.colors.textMuted },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  sectionHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
  row: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 10,
  },
  rowPressed: { opacity: 0.92, backgroundColor: '#F8FAFC' },
  rowMain: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 3, lineHeight: 16 },
  rowTail: { alignItems: 'flex-end', gap: 4, minWidth: 56 },
  format: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.primary, textTransform: 'uppercase' },

});
