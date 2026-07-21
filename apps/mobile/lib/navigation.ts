import { router, usePathname } from 'expo-router';
import { homeRoute } from '@/lib/homeRoute';
import { resolveApprovalHref, type ApprovalLink } from '@/lib/approvalLinks';
import type { ApprovalItem } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { pushOsNav, replaceOsNav, type OsNavHref } from '@/lib/pushOsNav';
import { pushOsTabNav } from '@/lib/osTabNav';

/**
 * W119: helpers поверх pushOsNav SoT —
 * stage/room/approval и useNavFromHere больше не зовут сырой router.push.
 */
export function pushStageDetail(id: string, returnTo?: string, role: OsRole = 'customer') {
  pushOsNav({ pathname: '/stage/[id]', params: { id } }, returnTo, role);
}

export function pushRoomDetail(id: string, returnTo?: string, role: OsRole = 'customer') {
  pushOsNav({ pathname: '/room/[id]', params: { id } }, returnTo, role);
}

export function pushApprovalLink(link: ApprovalLink, returnTo?: string, role: OsRole = 'customer') {
  pushOsNav(
    { pathname: link.pathname, params: link.params },
    returnTo,
    role,
  );
}

export function navigateApproval(item: ApprovalItem, role: OsRole, _stackReturnTo?: string) {
  const link = resolveApprovalHref(item, role, '/approvals');
  if (link) pushApprovalLink(link, link.params?.returnTo, role);
}

/** Текущий путь + навигация с returnTo для вкладок и hub-экранов */
export function useOsNavFromHere(role: OsRole) {
  const pathname = usePathname();
  return {
    returnTo: pathname,
    // W110: role → /control и short aliases резолвятся правильно
    pushNav: (target: OsNavHref) => pushOsNav(target, pathname, role),
    pushTab: (routeName: string, hubTab?: string, extra?: Record<string, string>) =>
      pushOsTabNav(role, routeName, hubTab, extra, pathname),
    pushScreen: (path: string, params?: Record<string, string>) =>
      pushOsNav({ pathname: path, params }, pathname, role),
  };
}

/** Текущий путь для returnTo при переходах в детальные экраны */
export function useNavFromHere(role: OsRole = 'customer') {
  const from = usePathname();
  return {
    from,
    stage: (id: string) => pushStageDetail(id, from, role),
    room: (id: string) => pushRoomDetail(id, from, role),
    material: (id: string) =>
      pushOsNav({ pathname: '/material/[id]', params: { id } }, from, role),
    purchase: (id: string) =>
      pushOsNav({ pathname: '/purchase/[id]', params: { id } }, from, role),
    workOrder: (id: string) =>
      pushOsNav({ pathname: '/work-order/[id]', params: { id } }, from, role),
    chat: (threadId: string, projectId?: string) =>
      pushOsNav(
        {
          pathname: '/chat/[threadId]',
          params: { threadId, ...(projectId ? { projectId } : {}) },
        },
        from,
        role,
      ),
    article: (slug: string) =>
      pushOsNav({ pathname: '/article/[slug]', params: { slug } }, from, role),
    scanReceipt: (roomId?: string, stageId?: string) =>
      pushOsNav(
        {
          pathname: '/scan-receipt',
          params: {
            ...(roomId ? { roomId } : {}),
            ...(stageId ? { stageId } : {}),
          },
        },
        from,
        role,
      ),
    href: (path: string) => pushOsNav(path, from, role),
    tab: (segment: string) => {
      const prefix = from.split('/(tabs)')[0];
      router.navigate({ pathname: `${prefix}/(tabs)/${segment}` as any, params: { returnTo: from } } as any);
    },
  };
}

export function goBack(returnTo?: string | string[], role?: string | null) {
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (rt && rt.length > 1) {
    const osRole: OsRole = role === 'contractor' ? 'contractor' : 'customer';
    // W110: тот же SoT, что pushOsNav
    replaceOsNav(rt, undefined, osRole);
    return;
  }
  if (router.canGoBack()) router.back();
  else router.replace(homeRoute(role) as any);
}

export function goHome(role?: string | null) {
  router.replace(homeRoute(role) as any);
}
