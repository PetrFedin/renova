import { evaluateApiBaseGuard, isLocalhostApiUrl } from './apiBaseGuard';

if (!isLocalhostApiUrl('http://127.0.0.1:8100')) throw new Error('localhost');
if (isLocalhostApiUrl('https://api.renova.app')) throw new Error('https');

const bad = evaluateApiBaseGuard('http://127.0.0.1:8100', 'staging');
if (!bad.blocked) throw new Error('staging+localhost must block');

const ok = evaluateApiBaseGuard('https://api.example.com', 'staging');
if (ok.blocked) throw new Error('https staging ok');

const dev = evaluateApiBaseGuard('http://127.0.0.1:8100', 'development');
if (dev.blocked) throw new Error('dev localhost allowed');

console.log('apiBaseGuard.test OK');
