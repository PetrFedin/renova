import { expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from '../helpers';

let identitySequence = 0;

export type GoldenUser = DemoUser & { phone: string; role: 'customer' | 'contractor' };

function nextPhone(): string {
  identitySequence += 1;
  const serial = String((Date.now() + identitySequence) % 10_000_000).padStart(7, '0');
  return `+7999${serial}`;
}

export async function registerOtpUser(
  request: APIRequestContext,
  role: 'customer' | 'contractor',
  options?: { fullName?: string; inn?: string },
): Promise<GoldenUser> {
  const phone = nextPhone();
  const deviceId = `golden-${role}-${phone.slice(-7)}`;
  const sent = await request.post(`${API}/api/v1/auth/sms/send`, {
    data: { phone, device_id: deviceId },
  });
  expect(sent.ok(), `OTP send failed: ${sent.status()}`).toBeTruthy();
  const sentBody = (await sent.json()) as {
    ok?: boolean;
    preview?: boolean;
    demo_code?: string;
    message?: string;
  };
  expect(sentBody.ok).toBe(true);
  expect(sentBody.preview, 'Golden local runtime must expose an explicit SMS preview, never fake delivery').toBe(true);
  expect(sentBody.demo_code, 'Local preview must expose the one-time test code').toMatch(/^\d{6}$/);

  const verified = await request.post(`${API}/api/v1/auth/sms/verify`, {
    data: {
      phone,
      code: sentBody.demo_code,
      role,
      full_name: options?.fullName ?? (role === 'customer' ? 'Golden Customer' : 'Golden Contractor'),
      ...(options?.inn ? { inn: options.inn } : {}),
      device_id: deviceId,
    },
  });
  expect(verified.ok(), `OTP verify failed: ${verified.status()}`).toBeTruthy();
  const user = (await verified.json()) as GoldenUser;
  expect(user.id).toBeTruthy();
  expect(user.access_token).toBeTruthy();
  expect(user.role).toBe(role);
  return { ...user, phone, role };
}

export function headers(user: GoldenUser | DemoUser): Record<string, string> {
  return authHeaders(user);
}

export async function createFreshProject(
  request: APIRequestContext,
  customer: GoldenUser | DemoUser,
  options?: { rooms?: Array<Record<string, unknown>>; renovationType?: string; name?: string },
) {
  const rooms = options?.rooms ?? [
    { name: 'Кухня', area_sqm: 12, length_m: 4, width_m: 3, height_m: 2.7, openings_sq_m: 2 },
    { name: 'Гостиная', area_sqm: 20, length_m: 5, width_m: 4, height_m: 2.7, openings_sq_m: 3 },
    { name: 'Спальня', area_sqm: 13.02, length_m: 4.2, width_m: 3.1, height_m: 2.7, openings_sq_m: 2 },
  ];
  const created = await request.post(`${API}/api/v1/projects`, {
    headers: headers(customer),
    data: {
      name: options?.name ?? `Golden object ${Date.now()}`,
      address: 'E2E Golden Path',
      renovation_type: options?.renovationType ?? 'cosmetic',
      property_type: 'apartment',
      total_area_sqm: rooms.reduce((sum, room) => sum + Number(room.area_sqm ?? 0), 0),
      rooms,
    },
  });
  expect(created.ok(), `project create failed: ${created.status()}`).toBeTruthy();
  return created.json();
}

export async function trashProject(
  request: APIRequestContext,
  customer: GoldenUser | DemoUser,
  projectId: string,
): Promise<void> {
  await request
    .post(`${API}/api/v1/projects/${projectId}/trash`, { headers: headers(customer) })
    .catch(() => undefined);
}

export function money(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}
