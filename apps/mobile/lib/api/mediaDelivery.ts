/** Authorized project-media delivery without leaking long-lived auth in image URLs. */
import { req } from './client';

type Capability = { url: string };

function mediaKey(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const marker = '/api/v1/media/';
  const markerIndex = rawUrl.indexOf(marker);
  if (markerIndex < 0) return null;
  let tail = rawUrl.slice(markerIndex + marker.length);
  const queryIndex = tail.indexOf('?');
  if (queryIndex >= 0) tail = tail.slice(0, queryIndex);
  if (!tail || tail.startsWith('capability/') || tail.startsWith('presign/')) return null;
  try {
    return decodeURIComponent(tail);
  } catch {
    return null;
  }
}

function encodedMediaKey(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function relativeMediaUrl(absoluteUrl: string): string {
  const marker = '/api/v1/media/';
  const markerIndex = absoluteUrl.indexOf(marker);
  return markerIndex >= 0 ? absoluteUrl.slice(markerIndex) : absoluteUrl;
}

export async function authorizeMediaUrl(
  userId: string,
  rawUrl: string | null | undefined,
  mode: 'absolute' | 'relative' = 'absolute',
): Promise<string | null | undefined> {
  const key = mediaKey(rawUrl);
  if (!key) return rawUrl;
  const capability = await req<Capability>(
    `/api/v1/media/capability/${encodedMediaKey(key)}`,
    {},
    userId,
  );
  return mode === 'relative' ? relativeMediaUrl(capability.url) : capability.url;
}

export async function authorizeStageMedia<T extends { photos?: Array<{ image_url?: string | null }> }>(
  userId: string,
  stage: T,
): Promise<T> {
  if (!stage.photos?.length) return stage;
  const photos = await Promise.all(
    stage.photos.map(async (photo) => ({
      ...photo,
      image_url: await authorizeMediaUrl(userId, photo.image_url, 'absolute'),
    })),
  );
  return { ...stage, photos };
}

export async function authorizeFloorPlanMedia<
  T extends { image_url?: string | null; punch?: Array<{ photo_url?: string | null }> },
>(userId: string, plans: T[]): Promise<T[]> {
  return Promise.all(
    plans.map(async (plan) => ({
      ...plan,
      image_url: await authorizeMediaUrl(userId, plan.image_url, 'relative'),
      punch: plan.punch
        ? await Promise.all(
            plan.punch.map(async (item) => ({
              ...item,
              photo_url: await authorizeMediaUrl(userId, item.photo_url, 'relative'),
            })),
          )
        : plan.punch,
    })),
  );
}

export async function authorizeDesignMedia<
  T extends { file_url?: string | null },
>(userId: string, packages: T[]): Promise<T[]> {
  return Promise.all(
    packages.map(async (item) => ({
      ...item,
      file_url: await authorizeMediaUrl(userId, item.file_url, 'relative'),
    })),
  );
}
