/** Общие хелперы E2E — один demo-customer на БД, стабильный проект не «Wizard Test». */
import type { Page } from '@playwright/test';

export const API = process.env.RENOVA_API ?? 'http://127.0.0.1:8100';
export const WEB = process.env.RENOVA_WEB ?? 'http://127.0.0.1:8081';

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
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ uid, pid }) => {
      localStorage.setItem('renova_user_id', uid);
      localStorage.setItem('renova_project_id', pid);
      localStorage.setItem('renova_user_role', 'customer');
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.removeItem('renova_pending_project_pick');
      localStorage.setItem('renova_project_explicitly_picked', '1');
    },
    { uid: userId, pid: projectId },
  );
  await page.reload();
}

export async function seedDemoContractorSession(
  page: Page,
  userId: string,
  projectId: string,
): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ uid, pid }) => {
      localStorage.setItem('renova_user_id', uid);
      localStorage.setItem('renova_project_id', pid);
      localStorage.setItem('renova_user_role', 'contractor');
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.removeItem('renova_pending_project_pick');
      localStorage.setItem('renova_project_explicitly_picked', '1');
    },
    { uid: userId, pid: projectId },
  );
  await page.reload();
}

/** Fresh project + lock estimate → planned stage + unsigned contract (E2E gate). */
export async function prepareContractGateScenario(
  request: import('@playwright/test').APIRequestContext,
): Promise<{
  contractorId: string;
  customerId: string;
  projectId: string;
  stageId: string;
  documentId: string;
}> {
  const cont = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })).json();
  const cust = await (await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })).json();
  const hCont = { 'X-User-Id': cont.id as string };
  const hCust = { 'X-User-Id': cust.id as string };

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

  await request.post(`${API}/api/v1/projects/${pid}/assign`, { headers: hCont });
  const locked = await request.post(`${API}/api/v1/projects/${pid}/estimate/lock`, { headers: hCont });
  if (!locked.ok()) throw new Error(`estimate lock failed: ${locked.status()}`);
  const lockBody = (await locked.json()) as { contract?: { document_id?: string } };
  const documentId = lockBody.contract?.document_id;
  if (!documentId) throw new Error('estimate lock missing contract.document_id');

  const detail = await (await request.get(`${API}/api/v1/projects/${pid}`, { headers: hCont })).json();
  const planned = (detail.stages as { id: string; status: string }[]).find((s) => s.status === 'planned');
  if (!planned) throw new Error('no planned stage for contract gate');
  return {
    contractorId: cont.id as string,
    customerId: cust.id as string,
    projectId: pid,
    stageId: planned.id,
    documentId,
  };
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
