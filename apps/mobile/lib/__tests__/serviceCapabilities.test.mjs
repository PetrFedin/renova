/**
 * node apps/mobile/lib/__tests__/serviceCapabilities.test.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function capabilityModeLabel(mode) {
  const m = (mode || 'off').toLowerCase();
  switch (m) {
    case 'live': return 'LIVE';
    case 'sandbox': return 'SANDBOX';
    case 'local': return 'LOCAL';
    case 'demo': return 'DEMO';
    case 'error': return 'ERROR';
    case 'off':
    default: return 'OFF';
  }
}

function normalizeCapability(raw) {
  return {
    available: Boolean(raw?.available),
    mode: raw?.mode || 'off',
    configured: Boolean(raw?.configured),
    healthy: Boolean(raw?.healthy),
    run_allowed: raw?.run_allowed,
    dev_bypass_available: raw?.dev_bypass_available,
  };
}

function ocrActionEnabled(cap) {
  return Boolean(cap?.available && cap.run_allowed !== false);
}

function showMoyNalogBypass(cap) {
  return Boolean(cap?.dev_bypass_available);
}

for (const m of ['live', 'sandbox', 'local', 'demo', 'off', 'error']) {
  const label = capabilityModeLabel(m);
  if (!['LIVE', 'SANDBOX', 'LOCAL', 'DEMO', 'OFF', 'ERROR'].includes(label)) {
    console.error('FAIL label', m, label);
    process.exit(1);
  }
}

const localCap = normalizeCapability({ available: true, mode: 'local', run_allowed: true });
if (capabilityModeLabel(localCap.mode) === 'DEMO') {
  console.error('FAIL local must not be DEMO');
  process.exit(1);
}
if (capabilityModeLabel(normalizeCapability({ mode: 'demo' }).mode) !== 'DEMO') {
  console.error('FAIL demo label');
  process.exit(1);
}

const offCap = normalizeCapability({ available: false, mode: 'off', run_allowed: false });
if (ocrActionEnabled(offCap) || !ocrActionEnabled(localCap)) {
  console.error('FAIL OCR gate');
  process.exit(1);
}

if (showMoyNalogBypass(normalizeCapability({ dev_bypass_available: false }))) {
  console.error('FAIL prod must hide bypass');
  process.exit(1);
}
if (!showMoyNalogBypass(normalizeCapability({ dev_bypass_available: true }))) {
  console.error('FAIL dev bypass should show');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const hub = readFileSync(join(__dirname, '../../components/renova/DocumentsHub.tsx'), 'utf8');
if (/setOcrModeLabel\(['"]DEMO['"]\)/.test(hub)) {
  console.error('FAIL DocumentsHub hardcoded DEMO');
  process.exit(1);
}
if (!hub.includes('getOcrHealth') || !hub.includes('ocrCap?.available')) {
  console.error('FAIL DocumentsHub missing OCR capability gate');
  process.exit(1);
}

const profile = readFileSync(join(__dirname, '../../components/screens/profile/ContractorProfileScreen.tsx'), 'utf8');
const bypassIdx = profile.indexOf('Включить флаг (без OAuth)');
const gateIdx = profile.indexOf('moyNalogCap?.dev_bypass_available');
if (bypassIdx < 0 || gateIdx < 0 || gateIdx > bypassIdx) {
  console.error('FAIL bypass button not gated by capability', { gateIdx, bypassIdx });
  process.exit(1);
}

console.log('OK serviceCapabilities');
