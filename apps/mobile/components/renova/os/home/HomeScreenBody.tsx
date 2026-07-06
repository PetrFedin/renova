/**
 * Контент главной Renova OS — зоны сверху вниз:
 * контекст → сделать сейчас → сводка → неделя → ещё
 */
import { ActivityFeed } from '@/components/renova/ActivityFeed';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
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
import { WeekScheduleStrip } from '@/components/renova/os/WeekScheduleStrip';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import { budgetTabRoute, tabsPrefix, type OsRole } from '@/constants/osSections';
import type { MaterialPick, OsInsight, ProjectDetail, ReceiptItem, User } from '@/lib/api';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import { HomeCompletionStrip } from '@/components/renova/os/home/HomeCompletionStrip';
import { resolveProjectPhase, type ProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';
import { useOsNavFromHere } from '@/lib/navigation';

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

  return (
    <>
      <ProjectOsHeader
        name={activeProject.name}
        headerMeta={headerMeta}
        showHealth={phase === 'active'}
        healthScore={snap.healthScore}
        healthLevel={snap.healthLevel}
        healthLabel={snap.healthLabel}
      />

      {role === 'customer' && !readOnly && (
        <ProjectProfileHint project={activeProject} role={role} />
      )}

      {role === 'contractor' && (
        <HomeLinkRow title="+ Заявки и новый объект" onPress={() => pushScreen('/job-leads')} />
      )}

      {showAttention && (
        <HomeActionHero
          role={inboxRole}
          snap={snap}
          insights={insights}
          showHero={isVisible('health_next')}
          showInbox={isVisible('inbox')}
          showInsights={isVisible('insights')}
        />
      )}

      {showKpi && (
        <HomeZone
          title="Сводка"
          linkLabel={showKpiHeaderLink ? 'Бюджет →' : undefined}
          onLinkPress={showKpiHeaderLink ? () => pushNav(kpiDetailHref) : undefined}
        >
          <OsKpiGrid snap={snap} rolePrefix={rolePrefix} role={role} gridTitle={null} />
        </HomeZone>
      )}

      {phase === 'complete' && (
        <HomeCompletionStrip role={role} userId={user.id} projectId={activeProject.id} />
      )}

      {isVisible('schedule') && (
        <WeekScheduleStrip userId={user.id} projectId={activeProject.id} role={role} />
      )}

      {moreHasContent && (
        <HomeMoreSection summary={moreSummary}>
          {showWorksMaterials && <WorksMaterialsTwinRow snap={snap} role={role} />}
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

      {!readOnly && (
        <HomeLinkRow
          leading="Вид главной"
          title="Настроить →"
          variant="trailingLink"
          onPress={() => pushTab('profile')}
        />
      )}
    </>
  );
}
