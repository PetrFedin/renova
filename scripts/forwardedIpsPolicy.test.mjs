/**
 * Запуск API обязан явно задавать, кому доверять X-Forwarded-For.
 *
 * По адресу клиента считаются лимит частоты и белый список IP для вебхуков.
 * Без настройки за балансировщиком приложение видит его адрес вместо адреса
 * клиента: лимит становится общим на всех, а белый список перестаёт отличать
 * провайдера от кого угодно, кто пришёл через тот же балансировщик.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const launcher = fs.readFileSync(path.resolve("backend/docker/renova-api"), "utf8");
const envExample = fs.readFileSync(path.resolve("backend/.env.example"), "utf8");

test("запуск API разбирает заголовки пересылки", () => {
  assert.ok(launcher.includes("--proxy-headers"), "нет --proxy-headers");
});

test("список доверенных прокси задаётся переменной с безопасным умолчанием", () => {
  assert.ok(launcher.includes("--forwarded-allow-ips"), "нет --forwarded-allow-ips");
  assert.ok(
    launcher.includes("${FORWARDED_ALLOW_IPS:-127.0.0.1}"),
    "умолчание должно быть localhost, а значение — настраиваемым",
  );
});

test("звёздочка не стоит умолчанием", () => {
  assert.ok(
    !/--forwarded-allow-ips\s+["']?\*/.test(launcher),
    "* доверяет заголовку от кого угодно",
  );
});

test("переменная описана в .env.example", () => {
  assert.ok(envExample.includes("FORWARDED_ALLOW_IPS"), "переменная не описана");
});
