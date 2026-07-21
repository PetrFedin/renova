/** Общие хелперы E2E — один demo-customer на БД, стабильный проект не «Wizard Test». */
import type { Page } from '@playwright/test';

export const API = process.env.RENOVA_API ?? 'http://127.0.0.1:8100';
export const WEB = process.env.RENOVA_WEB ?? 'http://127.0.0.1:8081';

/** Demo/auth user from POST /auth/demo — prefer Bearer (staging forbids X-User-Id). */
export type DemoUser = { id: string; access_token?: string | null; role?: string };

/** Auth header SoT for API e2e: JWT when present, else X-User-Id (dev only). */
export function authHeaders(user: DemoUser): Record<string, string> {
  const tok = user.access_token?.trim();
  if (tok) return { Authorization: `Bearer ${tok}` };
  return { 'X-User-Id': user.id };
}

export type DemoProject = {
  id: string;
  name: string;
  budget_spent?: number;
  contractor_id?: string | null;
  rooms?: { id: string }[];
  stages?: { id: string; status: string }[];
};

/** Канонический объект для прогона «серьёзный клиент» — не первый projects[0] из wizard/E2E. */
export function pickPrimaryDemoProject(projects: DemoProject[]): DemoProject {
  return (
    projects.find((p) => p.name?.includes('Демо-квартира')) ??
    projects.find((p) => p.name?.includes('Демо-дом')) ??
    projects.find((p) => !/wizard|test/i.test(p.name ?? '')) ??
    projects[0]
  );
}

/** Demo login через UI (web :8081) — роль заказчик + выбор объекта. */
export async function loginDemoCustomerUI(page: Page): Promise<void> {
  await page.goto('/onboarding/role');
  await page.getByText('Демо', { exact: true }).click();
  await page.getByText('Заказчик', { exact: true }).click();
  await page.getByRole('button', { name: /Продолжить/i }).click();

  const quizBtn = page.getByRole('button', { name: /Продолжить/i });
  if (await quizBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await quizBtn.click();
  }

  const projectCard = page.getByText(/Демо-квартира|Демо-дом/).first();
  if (await projectCard.isVisible({ timeout: 8000 }).catch(() => false)) {
    await projectCard.click();
  }
}

/** Быстрый demo-сессия через localStorage (web AsyncStorage) — стабильнее UI-login. */
export async function seedDemoCustomerSession(
  page: Page,
  userId: string,
  projectId: string,
  accessToken?: string | null,
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ uid, pid, tok }) => {
      localStorage.setItem('renova_user_id', uid);
      localStorage.setItem('renova_project_id', pid);
      localStorage.setItem('renova_user_role', 'customer');
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.removeItem('renova_pending_project_pick');
      localStorage.setItem('renova_project_explicitly_picked', '1');
      if (tok) localStorage.setItem('renova_access_token', tok);
    },
    { uid: userId, pid: projectId, tok: accessToken?.trim() || '' },
  );
  await page.reload();
}

export async function seedDemoContractorSession(
  page: Page,
  userId: string,
  projectId: string,
  accessToken?: string | null,
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ uid, pid, tok }) => {
      localStorage.setItem('renova_user_id', uid);
      localStorage.setItem('renova_project_id', pid);
      localStorage.setItem('renova_user_role', 'contractor');
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.removeItem('renova_pending_project_pick');
      localStorage.setItem('renova_project_explicitly_picked', '1');
      if (tok) localStorage.setItem('renova_access_token', tok);
    },
    { uid: userId, pid: projectId, tok: accessToken?.trim() || '' },
  );
  await page.reload();
}

/** Fresh project + lock estimate → planned stage + unsigned contract (E2E gate). */
export async function prepareContractGateScenario(
  request: import('@playwright/test').APIRequestContext,
): Promise<{
  contractorId: string;
  customerId: string;
  contractor: DemoUser;
  customer: DemoUser;
  projectId: string;
  stageId: string;
  documentId: string;
}> {
  const cont = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json()) as DemoUser;
  const cust = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json()) as DemoUser;
  const hCont = authHeaders(cont);
  const hCust = authHeaders(cust);

  const created = await request.post(`${API}/api/v1/projects`, {
    headers: hCust,
    data: {
      name: `E2E Contract Gate ${Date.now()}`,
      address: 'E2E',
      renovation_type: 'cosmetic',
      property_type: 'apartment',
      total_area_sqm: 40,
      rooms: [{ name: 'Комната', area_sqm: 20, length_m: 5, width_m: 4 }],
    },
  });
  if (!created.ok()) throw new Error(`create project failed: ${created.status()}`);
  const pid = ((await created.json()) as { id: string }).id;

  await request.post(`${API}/api/v1/subscription/checkout`, { headers: hCont });
  const assigned = await request.post(`${API}/api/v1/projects/${pid}/assign`, { headers: hCont });
  if (!assigned.ok()) throw new Error(`assign failed: ${assigned.status()}`);
  // W57: contractor proposes → customer finalizes lock (not contractor POST /lock)
  const proposed = await request.post(`${API}/api/v1/projects/${pid}/estimate/propose-lock`, {
    headers: hCont,
  });
  if (!proposed.ok()) throw new Error(`estimate propose-lock failed: ${proposed.status()}`);
  const locked = await request.post(`${API}/api/v1/projects/${pid}/estimate/lock`, { headers: hCust });
  if (!locked.ok()) throw new Error(`estimate lock failed: ${locked.status()}`);
  const lockBody = (await locked.json()) as { contract?: { document_id?: string } };
  const documentId = lockBody.contract?.document_id;
  if (!documentId) throw new Error('estimate lock missing contract.document_id');

  const detail = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont })).json();
  const planned = (detail.stages as { id: string; status: string }[]).find((s) => s.status === 'planned');
  if (!planned) throw new Error('no planned stage for contract gate');
  return {
    contractorId: cont.id,
    customerId: cust.id,
    contractor: cont,
    customer: cust,
    projectId: pid,
    stageId: planned.id,
    documentId,
  };
}

/** Убрать E2E Gate Test проект после spec (best-effort trash). */
export async function cleanupE2eGateProject(
  request: import('@playwright/test').APIRequestContext,
  customer: DemoUser | string,
  projectId: string,
): Promise<void> {
  const headers = typeof customer === 'string'
    ? { 'X-User-Id': customer }
    : authHeaders(customer);
  try {
    await request.post(`${API}/api/v1/projects/${projectId}/trash`, { headers });
  } catch {
    /* best-effort */
  }
}

export async function apiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function webReachable(): Promise<boolean> {
  try {
    const res = await fetch(WEB, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}
