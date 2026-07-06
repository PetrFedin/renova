#!/usr/bin/env node
/** После npm install в monorepo — поднимает критичные expo-пакеты в корень. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mustExist = ['expo-asset', 'expo-router', 'expo-modules-core', '@expo/vector-icons', 'inline-style-prefixer', 'postcss-value-parser'];
const missing = mustExist.filter((name) => !fs.existsSync(path.join(root, 'node_modules', name)));

if (missing.length === 0) {
  process.exit(0);
}

console.log('[renova] Hoisting Expo deps for mobile:', missing.join(', '));
try {
  execSync(`npm install ${missing.join(' ')} --workspace=mobile --no-audit --no-fund`, {
    cwd: root,
    stdio: 'inherit',
  });
} catch {
  // не блокируем install при ошибке сети
  console.warn('[renova] Warning: could not hoist mobile deps');
}
