import { router, usePathname } from 'expo-router';
import { homeRoute } from '@/lib/homeRoute';
import { resolveApprovalHref, type ApprovalLink } from '@/lib/approvalLinks';
import type { ApprovalItem } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { pushOsNav, type OsNavHref } from '@/lib/pushOsNav';
import { pushOsTabNav } from '@/lib/osTabNav';

/** Детальный экран этапа с опциональным returnTo */
export function pushStageDetail(id: string, returnTo?: string) {
  router.push({
    pathname: '/stage/[id]',
    params: { id, ...(returnTo ? { returnTo } : {}) },
  } as any);
}

/** Карточка комнаты с опциональным returnTo */
export function pushRoomDetail(id: string, returnTo?: string) {
  router.push({
    pathname: '/room/[id]',
    params: { id, ...(returnTo ? { returnTo } : {}) },
  } as any);
}

export function pushApprovalLink(link: ApprovalLink, returnTo?: string) {
  if (returnTo) {
    router.push({ pathname: link.pathname, params: { ...link.params, returnTo } } as any);
    return;
  }
  if (link.params) router.push({ pathname: link.pathname, params: link.params } as any);
  else router.push(link.pathname as any);
}

export function navigateApproval(item: ApprovalItem, role: OsRole, _stackReturnTo?: string) {
  const link = resolveApprovalHref(item, role, '/approvals');
  if (link) pushApprovalLink(link, link.params?.returnTo);
}

/** Текущий путь + навигация с returnTo для вкладок и hub-экранов */
export function useOsNavFromHere(role: OsRole) {
  const pathname = usePathname();
  return {
    returnTo: pathname,
    pushNav: (target: OsNavHref) => pushOsNav(target, pathname),
    pushTab: (routeName: string, hubTab?: string, extra?: Record<string, string>) =>
      pushOsTabNav(role, routeName, hubTab, extra, pathname),
    pushScreen: (path: string, params?: Record<string, string>) =>
      router.push({ pathname: path as any, params: { ...params, returnTo: pathname } }),
  };
}

/** Текущий путь для returnTo при переходах в детальные экраны */
export function useNavFromHere() {
  const from = usePathname();
  return {
    from,
    stage: (id: string) => pushStageDetail(id, from),
    room: (id: string) => pushRoomDetail(id, from),
    material: (id: string) => router.push({ pathname: '/material/[id]', params: { id, returnTo: from } }),
    purchase: (id: string) => router.push({ pathname: '/purchase/[id]', params: { id, returnTo: from } }),
    workOrder: (id: string) => router.push({ pathname: '/work-order/[id]', params: { id, returnTo: from } }),
    chat: (threadId: string) => router.push({ pathname: '/chat/[threadId]', params: { threadId, returnTo: from } }),
    article: (slug: string) => router.push({ pathname: '/article/[slug]', params: { slug, returnTo: from } }),
    scanReceipt: (roomId?: string, stageId?: string) => router.push({ pathname: '/scan-receipt', params: { returnTo: from, ...(roomId ? { roomId } : {}), ...(stageId ? { stageId } : {}) } }),
    href: (path: string) => router.push({ pathname: path as any, params: { returnTo: from } }),
    tab: (segment: string) => {
      const prefix = from.split('/(tabs)')[0];
      router.navigate({ pathname: `${prefix}/(tabs)/${segment}` as any, params: { returnTo: from } } as any);
    },
  };
}

export function goBack(returnTo?: string | string[], role?: string | null) {
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (rt && rt.length > 1) {
    router.replace(rt as any);
    return;
  }
  if (router.canGoBack()) router.back();
  else router.replace(homeRoute(role) as any);
}

export function goHome(role?: string | null) {
  router.replace(homeRoute(role) as any);
}
