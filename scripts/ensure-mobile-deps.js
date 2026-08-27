#!/usr/bin/env node
/**
 * Verify critical Expo workspace dependencies after a locked npm install.
 *
 * This hook must never mutate package.json/package-lock.json or fetch missing
 * packages opportunistically. `npm ci` is authoritative: if a declared/locked
 * dependency is absent from both valid npm-workspace resolution locations,
 * bootstrap fails and the lock/workspace must be repaired explicitly.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mobile = path.join(root, 'apps', 'mobile');
const mustExist = [
  'expo-asset',
  'expo-router',
  'expo-modules-core',
  '@expo/vector-icons',
  'inline-style-prefixer',
  'postcss-value-parser',
];

function dependencyExists(name) {
  return [
    path.join(root, 'node_modules', name),
    path.join(mobile, 'node_modules', name),
  ].some((candidate) => fs.existsSync(candidate));
}

const missing = mustExist.filter((name) => !dependencyExists(name));

if (missing.length > 0) {
  console.error(
    '[renova] Locked npm workspace is incomplete; missing critical mobile dependencies:',
    missing.join(', '),
  );
  console.error('[renova] Repair declarations/package-lock explicitly, then run npm ci again.');
  process.exit(2);
}

console.log('[renova] Locked mobile dependency contract verified.');
