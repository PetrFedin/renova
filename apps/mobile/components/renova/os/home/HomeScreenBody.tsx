/** Контент главной Renova OS — first viewport = статус + 1 hero CTA */
import { Text } from 'react-native';
import { ActivityFeed } from '@/components/renova/ActivityFeed';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { ProjectSitesPanel } from '@/components/renova/ProjectSitesPanel';
import { HomeActionHero } from '@/components/renova/os/HomeActionHero';
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { HomeMoreSection } from '@/components/renova/os/HomeMoreSection';
import { HomeZone } from '@/components/renova/os/HomeZone';
import {
  OsKpiGrid,
  ProjectOsHeader,
  RiskStrip,
  WorksMaterialsTwinRow,
} from '@/components/renova/os/ProjectOsPanels';
import { ProjectProfileHint } from '@/components/renova/os/ProjectProfileHint';
import { HomeSetupChecklist } from '@/components/renova/os/home/HomeSetupChecklist';
import { HomeAcceptanceBanner } from '@/components/renova/os/home/HomeAcceptanceBanner';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import { budgetTabRoute, HEADER_MORE_LINK_IDS, type OsRole } from '@/constants/osSections';
import type { MaterialPick, OsInsight, ProjectDetail, ReceiptItem, User } from '@/lib/api';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import { HomeCompletionLinks } from '@/components/renova/os/home/HomeCompletionStrip';
import { roleScopeLabel } from '@/lib/domain/roleCapabilities';
import { resolveProjectPhase, type ProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';
import { homeTypography } from '@/constants/homeTypography';
import { useOsNavFromHere } from '@/lib/navigation';
import { menuRoutes } from '@/lib/routeRegistry';

export type HomeScreenBodyProps = {
  role: OsRole;
  user: User;
  activeProject: ProjectDetail;
  projectsCount: number;
  snap: ProjectOsSnapshot;
  headerMeta: ProjectHeaderMeta;
  readOnly: boolean;
  insights: OsInsight[];
  budgetAlerts: BudgetAlert[];
  receipts: ReceiptItem[];
  picks: MaterialPick[];
  moreSummary: string;
  moreHasContent: boolean;
  showWorksMaterials: boolean;
  showAttention: boolean;
  showKpi: boolean;
  isVisible: (id: HomeWidgetId) => boolean;
};

export function HomeScreenBody({
  role,
  user,
  activeProject,
  projectsCount: _projectsCount,
  snap,
  headerMeta,
  readOnly,
  insights,
  budgetAlerts,
  receipts,
  picks,
  moreSummary,
  moreHasContent,
  showWorksMaterials,
  showAttention,
  showKpi,
  isVisible,
}: HomeScreenBodyProps) {
  const { pushNav, pushScreen, pushTab, returnTo } = useOsNavFromHere(role);
  const rolePrefix = role === 'contractor' ? '/(contractor)/(tabs)' : '/(customer)/(tabs)';
  const phase = resolveProjectPhase(snap);
  const inboxRole = readOnly ? 'customer' : role;
  const kpiDetailHref = budgetTabRoute(role, 'summary', { period: 'month', focus: 'fact' });
  const showKpiHeaderLink = phase !== 'closing';
  const moneyZoneTitle = 'Деньги';

  /**
   * Clarity A: first viewport = header + 1 hero (customer и contractor в active).
   * KPI / «В работе» — в «Сводка». Clarity D: strip сроков убран — только ссылка в календарь.
   */
  const leanFirstViewport = phase === 'active' && !readOnly;
  const showKpiMain = showKpi && !leanFirstViewport;
  const showWorksMain = showWorksMaterials && !snap.isComplete && !leanFirstViewport;
  /** Ссылка «Сроки» без WeekScheduleStrip — дубль с вкладкой календаря */
  const showScheduleLink = isVisible('schedule');
  const showKpiInMore = leanFirstViewport && showKpi;
  const showWorksInMore = leanFirstViewport && showWorksMaterials && !snap.isComplete;

  const showMore =
    moreHasContent ||
    phase === 'complete' ||
    showKpiInMore ||
    showWorksInMore ||
    (leanFirstViewport && showScheduleLink);
  const moreSectionSummary = phase === 'complete'
    ? (moreSummary ? `отчёты · ${moreSummary}` : 'отчёты · экспорт')
    : leanFirstViewport
      ? [moreSummary, showKpiInMore ? 'деньги' : '', showScheduleLink ? 'сроки' : '']
          .filter(Boolean)
          .join(' · ') || 'деньги · сроки'
      : moreSummary;

  return (
    <>
      {/* 1. Статус */}
      <ProjectOsHeader
        name={activeProject.name}
        headerMeta={headerMeta}
        showHealth={phase === 'active'}
        healthScore={snap.healthScore}
        healthLevel={snap.healthLevel}
        healthLabel={snap.healthLabel}
      />
      <OfflineSyncStatus compact />
      {readOnly ? (
        <Text style={homeTypography.homeSubtitle}>{roleScopeLabel({ role, readOnly })}</Text>
      ) : null}

      {role === 'contractor' && phase === 'active' && !leanFirstViewport && (
        <HomeLinkRow title="Заявки и новые объекты" onPress={() => pushScreen('/job-leads')} />
      )}

      {/* 2. Единственный hero first-viewport (до чеклиста и KPI) */}
      {/* Lean: баннер приёмки конкурирует с hero — оставляем только HomeActionHero */}
      {!leanFirstViewport && snap.quality.awaitingAcceptance > 0 && snap.nextAction.kind !== 'accept' ? (
        <HomeAcceptanceBanner
          count={snap.quality.awaitingAcceptance}
          role={role}
          href={snap.activeWorks.find((w) => w.status === 'review')?.href}
        />
      ) : null}
      {showAttention && phase !== 'complete' && (
        <HomeActionHero
          role={inboxRole}
          snap={snap}
          insights={insights}
          showHero={isVisible('health_next')}
          showInbox={isVisible('inbox')}
          showInsights={isVisible('insights')}
        />
      )}

      {/* Lean contractor: одна secondary-строка после hero, не до него */}
      {role === 'contractor' && phase === 'active' && leanFirstViewport && (
        <HomeLinkRow title="Заявки и новые объекты" onPress={() => pushScreen('/job-leads')} />
      )}

      {/* 3. Настройка — после hero, чтобы CTA не конкурировал с nextAction */}
      {role === 'customer' && !readOnly && (
        <>
          <HomeSetupChecklist project={activeProject} snap={snap} role={role} />
          {!leanFirstViewport ? <ProjectProfileHint project={activeProject} role={role} /> : null}
        </>
      )}

      {/* 4. Деньги / работа / сроки — на lean уходят в «Сводка» */}
      {showKpiMain && (
        <HomeZone
          title={moneyZoneTitle}
          linkLabel={showKpiHeaderLink ? 'Подробнее →' : undefined}
          onLinkPress={showKpiHeaderLink ? () => pushNav(kpiDetailHref) : undefined}
        >
          <OsKpiGrid snap={snap} rolePrefix={rolePrefix} role={role} gridTitle={null} />
        </HomeZone>
      )}

      {showWorksMain && (
        <HomeZone title="В работе">
          <WorksMaterialsTwinRow snap={snap} role={role} />
        </HomeZone>
      )}

      {/* Clarity D: без WeekScheduleStrip — календарь SoT для сроков */}
      {!leanFirstViewport && showScheduleLink ? (
        <HomeLinkRow title="Сроки" onPress={() => pushTab('calendar')} />
      ) : null}

      {/* 5. Сводка — вторичные поверхности + lean-блоки (не путать с шапкой «Ещё») */}
      {showMore && (
        <HomeMoreSection summary={moreSectionSummary} title="Сводка">
          {showKpiInMore ? (
            <HomeZone
              title={moneyZoneTitle}
              linkLabel={showKpiHeaderLink ? 'Подробнее →' : undefined}
              onLinkPress={showKpiHeaderLink ? () => pushNav(kpiDetailHref) : undefined}
            >
              <OsKpiGrid snap={snap} rolePrefix={rolePrefix} role={role} gridTitle={null} />
            </HomeZone>
          ) : null}
          {showWorksInMore ? (
            <HomeZone title="В работе">
              <WorksMaterialsTwinRow snap={snap} role={role} />
            </HomeZone>
          ) : null}
          {leanFirstViewport && showScheduleLink ? (
            <HomeLinkRow title="Сроки" onPress={() => pushTab('calendar')} />
          ) : null}
          {menuRoutes(role === 'contractor' ? 'contractor' : 'customer', 'more', {
            readOnly,
            phase,
            // Util-навигация — только шапка «Ещё» (HEADER_MORE_LINK_IDS); здесь не дублируем
            excludeIds: [...HEADER_MORE_LINK_IDS],
          }).map((route) => (
            <HomeLinkRow
              key={route.id}
              title={route.titleRu}
              onPress={() => pushScreen(route.path)}
            />
          ))}
          {phase === 'complete' && (
            <HomeCompletionLinks role={role} userId={user.id} projectId={activeProject.id} />
          )}
          {isVisible('budget_alerts') && <BudgetAlerts items={budgetAlerts} returnTo={returnTo} />}
          {isVisible('sites') && (
            <ProjectSitesPanel
              project={activeProject}
              receipts={receipts}
              picks={picks}
              compact
              role={role}
              returnTo={returnTo}
            />
          )}
          {isVisible('risks') && <RiskStrip snap={snap} role={role} />}
          {isVisible('activity') && (
            <ActivityFeed
              userId={user.id}
              projectId={activeProject.id}
              compact
              hidePaymentDupes={snap.nextAction.kind === 'payment'}
              returnTo={returnTo}
            />
          )}
        </HomeMoreSection>
      )}
    </>
  );
}
