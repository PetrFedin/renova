#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/assert-expo-public-config.mjs <config.json>');
  process.exit(2);
}

const config = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(config.name, 'Renova', 'resolved Expo app name');
assert.equal(config.slug, 'renova', 'resolved Expo slug');
assert.equal(config.extra?.locale, 'ru', 'resolved runtime locale');
assert.equal(
  config.ios?.infoPlist?.CFBundleDevelopmentRegion,
  'ru',
  'resolved iOS development region',
);
assert.equal(config.ios?.bundleIdentifier, 'ru.renova.app', 'resolved iOS bundle identifier');
assert.ok(
  Array.isArray(config.plugins)
    && config.plugins.some(
      (plugin) => Array.isArray(plugin)
        && plugin[0] === 'expo-notifications'
        && plugin[1]?.enableBackgroundRemoteNotifications === true,
    ),
  'resolved expo-notifications plugin with background remote notifications',
);

console.log('Expo public config accepted: locale=ru, iOS region=ru, notifications plugin=enabled');
