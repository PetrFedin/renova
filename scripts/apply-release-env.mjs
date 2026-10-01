#!/usr/bin/env node
/**
 * Подставляет реквизиты релиза из окружения в apps/mobile/eas.json (в рабочей копии CI/локально).
 * eas.json не умеет читать переменные, поэтому владелец вписывает значения в env/секреты, а не в код:
 *
 *   RENOVA_API_URL_STAGING      -> build.{preview,testflight,staging}.env.EXPO_PUBLIC_API_URL
 *   RENOVA_API_URL_PRODUCTION   -> build.production.env.EXPO_PUBLIC_API_URL
 *   RENOVA_ASC_APP_ID           -> submit.{testflight,production}.ios.ascAppId
 *   RENOVA_APPLE_TEAM_ID        -> submit.{testflight,production}.ios.appleTeamId
 *   RENOVA_GOOGLE_SERVICE_ACCOUNT_KEY_PATH -> submit.production.android.serviceAccountKeyPath
 *   RENOVA_ANDROID_TRACK        -> submit.production.android.track (по умолчанию остаётся как в файле)
 *
 * Режимы: без флагов — записать то, что задано; --check — вывести незаполненные PLACEHOLDER
 * (код 1, если есть); --dry-run — не писать файл. Значения не логируются.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPath = path.join(root, 'apps/mobile/eas.json');

const isPlaceholder = (v) => typeof v !== 'string' || v === '' || /PLACEHOLDER|\.invalid(\/|$|:)/i.test(v);
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function applyEnv(eas, env) {
  const out = structuredClone(eas);
  const applied = [];
  const set = (obj, key, value, label) => {
    if (value === undefined || !obj) return;
    obj[key] = value;
    applied.push(label);
  };
  for (const name of ['preview', 'testflight', 'staging']) {
    set(out.build?.[name]?.env, 'EXPO_PUBLIC_API_URL', clean(env.RENOVA_API_URL_STAGING), `build.${name}.env.EXPO_PUBLIC_API_URL`);
  }
  set(out.build?.production?.env, 'EXPO_PUBLIC_API_URL', clean(env.RENOVA_API_URL_PRODUCTION), 'build.production.env.EXPO_PUBLIC_API_URL');
  for (const name of ['testflight', 'production']) {
    set(out.submit?.[name]?.ios, 'ascAppId', clean(env.RENOVA_ASC_APP_ID), `submit.${name}.ios.ascAppId`);
    set(out.submit?.[name]?.ios, 'appleTeamId', clean(env.RENOVA_APPLE_TEAM_ID), `submit.${name}.ios.appleTeamId`);
  }
  set(out.submit?.production?.android, 'serviceAccountKeyPath', clean(env.RENOVA_GOOGLE_SERVICE_ACCOUNT_KEY_PATH), 'submit.production.android.serviceAccountKeyPath');
  set(out.submit?.production?.android, 'track', clean(env.RENOVA_ANDROID_TRACK), 'submit.production.android.track');
  return { eas: out, applied };
}

export function unfilled(eas) {
  const gaps = [];
  for (const name of ['preview', 'testflight', 'staging', 'production']) {
    const url = eas.build?.[name]?.env?.EXPO_PUBLIC_API_URL;
    if (isPlaceholder(url) || /example\.com/i.test(url)) gaps.push(`build.${name}.env.EXPO_PUBLIC_API_URL`);
  }
  for (const [profile, platforms] of Object.entries(eas.submit ?? {})) {
    for (const [platform, fields] of Object.entries(platforms)) {
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'string' && /PLACEHOLDER/.test(value)) gaps.push(`submit.${profile}.${platform}.${key}`);
      }
    }
  }
  return gaps;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const file = process.env.RENOVA_EAS_JSON || defaultPath;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args.has('--check')) {
    const gaps = unfilled(current);
    if (gaps.length) {
      console.error(`eas.json: не заполнено (${gaps.length}):\n- ${gaps.join('\n- ')}`);
      process.exit(1);
    }
    console.log('eas.json: PLACEHOLDER не осталось');
  } else {
    const { eas, applied } = applyEnv(current, process.env);
    if (!args.has('--dry-run')) fs.writeFileSync(file, `${JSON.stringify(eas, null, 2)}\n`);
    console.log(`eas.json: применено полей: ${applied.length}${applied.length ? ` (${applied.join(', ')})` : ''}`);
    const gaps = unfilled(eas);
    if (gaps.length) console.log(`ещё не заполнено: ${gaps.join(', ')}`);
  }
}
