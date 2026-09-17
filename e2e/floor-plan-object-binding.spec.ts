/**
 * #377 — cross-project object binding for floor plans, pins and furniture.
 *
 * Both projects belong to the same authenticated customer. A 404 therefore
 * proves resource-to-path binding rather than an unrelated project-access denial.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, type DemoUser } from './helpers';

function projectPayload(name: string) {
  return {
    name,
    address: 'Floor object binding E2E',
    renovation_type: 'cosmetic',
    property_type: 'apartment',
    total_area_sqm: 12,
    rooms: [
      {
        name: `${name} room`,
        room_type: 'living',
        length_m: 4,
        width_m: 3,
        height_m: 2.7,
        outlets_count: 1,
        switches_count: 1,
        plumbing_points: 0,
      },
    ],
  };
}

async function createProject(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
) {
  const response = await request.post(`${API}/api/v1/projects`, {
    headers,
    data: projectPayload(name),
  });
  expect(response.status()).toBe(200);
  const project = await response.json();
  expect(project.rooms?.length).toBeGreaterThan(0);
  return { id: project.id as string, roomId: project.rooms[0].id as string };
}

async function createPlan(
  request: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
  marker: string,
) {
  const response = await request.post(`${API}/api/v1/projects/${projectId}/floor-plans`, {
    headers,
    data: {
      name: `Plan ${marker}`,
      floor_level: 1,
      image_key: `e2e/floor-${marker}.png`,
      width_px: 1200,
      height_px: 800,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { id: string; pins: unknown[] };
}

test.describe('P0 floor-plan object binding', () => {
  test('foreign pin/room/plan references return privacy 404 and leave source project unchanged', async ({ request }) => {
    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const headers = authHeaders(customer);

    const marker = Date.now();
    const projectA = await createProject(request, headers, `Floor A ${marker}`);
    const projectB = await createProject(request, headers, `Floor B ${marker}`);

    try {
      const planA = await createPlan(request, headers, projectA.id, `a-${marker}`);
      const planB = await createPlan(request, headers, projectB.id, `b-${marker}`);

      const pinBResponse = await request.post(
        `${API}/api/v1/projects/${projectB.id}/floor-plans/${planB.id}/pins`,
        {
          headers,
          data: {
            room_id: projectB.roomId,
            x_pct: 17,
            y_pct: 23,
            label: 'B pin',
          },
        },
      );
      expect(pinBResponse.status()).toBe(200);
      const pinB = (await pinBResponse.json()) as { id: string; x_pct: number; y_pct: number };

      const moveForeignPin = await request.patch(
        `${API}/api/v1/projects/${projectA.id}/floor-plans/${planA.id}/pins/${pinB.id}`,
        { headers, data: { x_pct: 88, y_pct: 91 } },
      );
      expect(moveForeignPin.status()).toBe(404);

      const plansBAfterAttack = (await (
        await request.get(`${API}/api/v1/projects/${projectB.id}/floor-plans`, { headers })
      ).json()) as { id: string; pins: { id: string; x_pct: number; y_pct: number }[] }[];
      const pinBAfterAttack = plansBAfterAttack
        .find((plan) => plan.id === planB.id)
        ?.pins.find((pin) => pin.id === pinB.id);
      expect(pinBAfterAttack).toMatchObject({ x_pct: 17, y_pct: 23 });

      const foreignRoomPin = await request.post(
        `${API}/api/v1/projects/${projectA.id}/floor-plans/${planA.id}/pins`,
        {
          headers,
          data: {
            room_id: projectB.roomId,
            x_pct: 11,
            y_pct: 22,
            label: 'foreign room',
          },
        },
      );
      expect(foreignRoomPin.status()).toBe(404);

      const foreignRoomFurniture = await request.post(`${API}/api/v1/projects/${projectA.id}/furniture`, {
        headers,
        data: {
          room_id: projectB.roomId,
          name: 'Foreign room chair',
          client_request_id: `floor-e2e-foreign-room-${marker}`,
        },
      });
      expect(foreignRoomFurniture.status()).toBe(404);

      const foreignPlanFurniture = await request.post(`${API}/api/v1/projects/${projectA.id}/furniture`, {
        headers,
        data: {
          floor_plan_id: planB.id,
          name: 'Foreign plan chair',
          client_request_id: `floor-e2e-foreign-plan-${marker}`,
        },
      });
      expect(foreignPlanFurniture.status()).toBe(404);

      const mixedFurniture = await request.post(`${API}/api/v1/projects/${projectA.id}/furniture`, {
        headers,
        data: {
          room_id: projectA.roomId,
          floor_plan_id: planB.id,
          name: 'Mixed refs chair',
          client_request_id: `floor-e2e-mixed-${marker}`,
        },
      });
      expect(mixedFurniture.status()).toBe(404);

      const furnitureAfterAttacks = (await (
        await request.get(`${API}/api/v1/projects/${projectA.id}/furniture`, { headers })
      ).json()) as { id: string; name: string }[];
      expect(furnitureAfterAttacks.some((item) => item.name.includes('Foreign') || item.name.includes('Mixed'))).toBe(false);

      const pinAResponse = await request.post(
        `${API}/api/v1/projects/${projectA.id}/floor-plans/${planA.id}/pins`,
        {
          headers,
          data: {
            room_id: projectA.roomId,
            x_pct: 25,
            y_pct: 35,
            label: 'A pin',
          },
        },
      );
      expect(pinAResponse.status()).toBe(200);
      const pinA = (await pinAResponse.json()) as { id: string };

      const moveOwnPin = await request.patch(
        `${API}/api/v1/projects/${projectA.id}/floor-plans/${planA.id}/pins/${pinA.id}`,
        { headers, data: { x_pct: 40, y_pct: 50 } },
      );
      expect(moveOwnPin.status()).toBe(200);
      expect(await moveOwnPin.json()).toMatchObject({ id: pinA.id, x_pct: 40, y_pct: 50 });

      const ownFurniture = await request.post(`${API}/api/v1/projects/${projectA.id}/furniture`, {
        headers,
        data: {
          room_id: projectA.roomId,
          floor_plan_id: planA.id,
          name: 'Own chair',
          x_pct: 10,
          y_pct: 15,
          client_request_id: `floor-e2e-own-${marker}`,
        },
      });
      expect(ownFurniture.status()).toBe(200);
      const ownFurnitureBody = (await ownFurniture.json()) as { id: string; replayed: boolean };
      expect(ownFurnitureBody.replayed).toBe(false);

      const moveOwnFurniture = await request.patch(
        `${API}/api/v1/projects/${projectA.id}/furniture/${ownFurnitureBody.id}`,
        { headers, data: { x_pct: 60, y_pct: 70 } },
      );
      expect(moveOwnFurniture.status()).toBe(200);
      expect(await moveOwnFurniture.json()).toMatchObject({ ok: true, x_pct: 60, y_pct: 70 });

      const ownFurnitureList = (await (
        await request.get(`${API}/api/v1/projects/${projectA.id}/furniture`, { headers })
      ).json()) as {
        id: string;
        room_id: string | null;
        floor_plan_id: string | null;
        x_pct: number | null;
        y_pct: number | null;
      }[];
      expect(ownFurnitureList.find((item) => item.id === ownFurnitureBody.id)).toMatchObject({
        room_id: projectA.roomId,
        floor_plan_id: planA.id,
        x_pct: 60,
        y_pct: 70,
      });
    } finally {
      await request.post(`${API}/api/v1/projects/${projectA.id}/trash`, { headers }).catch(() => undefined);
      await request.post(`${API}/api/v1/projects/${projectB.id}/trash`, { headers }).catch(() => undefined);
    }
  });
});
