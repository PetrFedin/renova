/** Контент главной Renova OS — 5 блоков: статус → действие → деньги → работа → события */
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
import { WeekScheduleStrip } from '@/components/renova/os/WeekScheduleStrip';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import type { MaterialPick, OsInsight, ProjectDetail, ReceiptItem, User } from '@/lib/api';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import { HomeCompletionLinks } from '@/components/renova/os/home/HomeCompletionStrip';
import { roleScopeLabel } from '@/lib/domain/roleCapabilities';
import { resolveProjectPhase, type ProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';
import { homeTypography } from '@/constants/homeTypography';
import { useOsNavFromHere } from '@/lib/navigation';
import { buildSecondaryNavigation, getRouteLabel } from '@/lib/navigation/navigationPolicy';
import { DOCK_DEFAULT } from '@/constants/dockBar';

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
  projectsCount,
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
  const moneyZoneTitle = role === 'customer' ? 'Деньги' : 'Сводка';

  const showMore = readOnly || moreHasContent || phase === 'complete';
  const headerIds = new Set(buildSecondaryNavigation({
    role,
    readOnly,
    guest: readOnly,
    phase,
    dockItems: DOCK_DEFAULT,
    surface: 'header',
  }).map((route) => route.id));
  const secondaryRoutes = buildSecondaryNavigation({
    role,
    readOnly,
    guest: readOnly,
    phase,
    dockItems: DOCK_DEFAULT,
    surface: 'home',
  }).filter((route) => readOnly || !headerIds.has(route.id));
  const moreSectionSummary = phase === 'complete'
    ? (moreSummary ? `отчёты · ${moreSummary}` : 'отчёты · экспорт')
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

      {role === 'customer' && !readOnly && (
        <>
          <ProjectProfileHint project={activeProject} role={role} />
          <HomeSetupChecklist project={activeProject} snap={snap} role={role} />
        </>
      )}

      {role === 'contractor' && phase === 'active' && (
        <HomeLinkRow title="Заявки и новые объекты" onPress={() => pushScreen('/job-leads')} />
      )}

      {/* 2. Очередь дел — единственный attention SoT (hero + inbox; без отдельной строки «Входящие») */}
      {/* W47/W56: banner для обеих ролей; у contractor — «ждут заказчика», не дубль hero accept */}
      {snap.quality.awaitingAcceptance > 0 && snap.nextAction.kind !== 'accept' ? (
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

      {/* 3. Деньги */}
      {showKpi && (
        <HomeZone
          title={moneyZoneTitle}
          linkLabel={showKpiHeaderLink ? 'Подробнее →' : undefined}
          onLinkPress={showKpiHeaderLink ? () => pushNav(kpiDetailHref) : undefined}
        >
          <OsKpiGrid snap={snap} rolePrefix={rolePrefix} role={role} gridTitle={null} />
        </HomeZone>
      )}

      {/* 4. Что в работе */}
      {showWorksMaterials && !snap.isComplete && (
        <HomeZone title="В работе">
          <WorksMaterialsTwinRow snap={snap} role={role} />
        </HomeZone>
      )}

      {/* 5. Сроки — один preview → hub /calendar (без второго WorkSchedule card) */}
      {isVisible('schedule') && (
        <HomeZone
          title="Сроки"
          linkLabel="Открыть →"
          onLinkPress={() => pushTab('calendar')}
        >
          <WeekScheduleStrip userId={user.id} projectId={activeProject.id} role={role} embedded />
        </HomeZone>
      )}

      {/* Дополнительно — свёрнуто; приёмка/уведомления не дублируем (Ремонт / Входящие) */}
      {showMore && (
        <HomeMoreSection summary={moreSectionSummary}>
          {secondaryRoutes.map((route) => (
            <HomeLinkRow
              key={route.id}
              title={getRouteLabel(route, role)}
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
