/**
 * Рубеж: образы в docker-compose тянутся из существующих, реально доступных реестров.
 *
 * История:
 * 1) `minio/minio` на Docker Hub перестал существовать — репозиторий отдаёт
 *    `pull access denied ... repository does not exist or may require 'docker login'`.
 *    Из-за этого падала проверка source-and-runtime на КАЖДОМ pull request.
 *    Образ переехал на `quay.io/minio/minio` (#551).
 * 2) Затем MinIO Inc. закрыла и `quay.io/minio/minio` тоже — любой тег там
 *    теперь отдаёт `401 UNAUTHORIZED` без платной подписки (проверено прямым
 *    `docker pull`/`curl` на оба реестра непосредственно перед этой правкой).
 *    Свободного, публично доступного `minio/minio` больше не существует ни
 *    на одном реестре. Единственный оставшийся бесплатный публичный образ —
 *    замороженный `bitnamilegacy/minio` (Bitnami закрыли `bitnami/minio` тем
 *    же способом, `bitnamilegacy/*` — их последний свободный слепок).
 *
 * Проверка статическая, без сети: запрещает откат на гарантированно
 * недоступные образы и требует, чтобы MinIO-сервис был закреплён по digest
 * (замороженный образ не получает новых тегов — плавающий тег здесь бессмыслен
 * и означал бы, что кто-то по ошибке скопировал синтаксис старого сервиса).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url).pathname;

/** Образы, о которых точно известно, что реестр отдаёт по ним отказ. */
const GATED_IMAGES = new Set([
  'minio/minio',
  'minio/mc',
  'quay.io/minio/minio',
  'quay.io/minio/mc',
  'bitnami/minio',
]);

function composeImages(file) {
  const text = readFileSync(`${repoRoot}${file}`, 'utf8');
  return [...text.matchAll(/^\s*image:\s*(\S+)/gm)].map((match) => match[1]);
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.staging.yml'];

for (const file of COMPOSE_FILES) {
  test(`${file}: не используются образы, о которых уже известно, что реестр их не отдаёт`, () => {
    const wrong = [];
    for (const image of composeImages(file)) {
      // "repo/name:TAG" или "repo/name@sha256:..." -> "repo/name"
      const withoutRef = image.split(/[:@]/)[0];
      if (GATED_IMAGES.has(withoutRef)) {
        wrong.push(image);
      }
    }
    assert.deepEqual(wrong, [], `известно недоступные образы: ${wrong.join(', ')}`);
  });
}

test('docker-compose.yml всё ещё поднимает MinIO', () => {
  // Правка источника образа не должна незаметно выкинуть сам сервис.
  const images = composeImages('docker-compose.yml');
  assert.ok(
    images.some((image) => /minio/i.test(image)),
    'сервис MinIO исчез из docker-compose.yml',
  );
});

test('образ MinIO закреплён по digest, а не по плавающему тегу', () => {
  // bitnamilegacy/minio заморожен: новых тегов у него не будет. Плавающий
  // тег (":latest" или голое имя) молча съедет на другой билд при следующем
  // pull — закрепляем воспроизводимость по digest.
  const images = composeImages('docker-compose.yml');
  const minio = images.find((image) => /minio/i.test(image));
  assert.ok(minio, 'образ MinIO не найден');
  assert.match(
    minio,
    /@sha256:[0-9a-f]{64}$/,
    `образ MinIO должен быть закреплён по digest, а не по тегу: ${minio}`,
  );
});
