/**
 * Рубеж: образы в docker-compose тянутся из существующих реестров.
 *
 * `minio/minio` на Docker Hub перестал существовать — репозиторий отдаёт 404,
 * а `docker pull` объясняет это невнятно:
 *
 *   pull access denied for minio/minio, repository does not exist
 *   or may require 'docker login'
 *
 * Из-за этого падала проверка source-and-runtime на КАЖДОМ pull request, к
 * содержимому правок отношения не имея. Образы MinIO публикуются на quay.io.
 *
 * Проверка статическая, без сети: сверяет, что известные переехавшие образы
 * записаны с нужным реестром.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('..', import.meta.url).pathname;

/** Образ -> реестр, из которого он действительно доступен. */
const MOVED_IMAGES = new Map([
  ['minio/minio', 'quay.io'],
  ['minio/mc', 'quay.io'],
]);

function composeImages(file) {
  const text = readFileSync(`${repoRoot}${file}`, 'utf8');
  return [...text.matchAll(/^\s*image:\s*(\S+)/gm)].map((match) => match[1]);
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.staging.yml'];

for (const file of COMPOSE_FILES) {
  test(`${file}: переехавшие образы указаны с нужным реестром`, () => {
    const wrong = [];
    for (const image of composeImages(file)) {
      // Имя без реестра: "minio/minio:TAG" -> "minio/minio"
      const withoutTag = image.split(':')[0];
      const expectedRegistry = MOVED_IMAGES.get(withoutTag);
      if (expectedRegistry) {
        wrong.push(`${image} → нужен ${expectedRegistry}/${withoutTag}`);
      }
    }
    assert.deepEqual(wrong, [], `недоступные образы: ${wrong.join(', ')}`);
  });
}

test('docker-compose.yml всё ещё поднимает MinIO', () => {
  // Правка реестра не должна незаметно выкинуть сам сервис.
  const images = composeImages('docker-compose.yml');
  assert.ok(
    images.some((image) => image.includes('minio/minio')),
    'сервис MinIO исчез из docker-compose.yml',
  );
});

test('версия образа MinIO не менялась вместе с реестром', () => {
  // Переезд реестра — это переезд, а не апгрейд: тот же тег доступен на quay.
  const images = composeImages('docker-compose.yml');
  const minio = images.find((image) => image.includes('minio/minio'));
  assert.ok(minio, 'образ MinIO не найден');
  assert.match(
    minio,
    /:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/,
    `тег должен остаться закреплённым релизом, а не плавающим: ${minio}`,
  );
});
