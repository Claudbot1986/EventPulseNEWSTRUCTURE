#!/usr/bin/env node
/**
 * Start Expo dev server with the correct hostname for remote devices.
 *
 * Priority:
 * 1. REACT_NATIVE_PACKAGER_HOSTNAME (if already set)
 * 2. Tailscale IPv4 (`tailscale ip -4`)
 * 3. First non-internal IPv4 from network interfaces
 *
 * With Tailscale, prefer LAN mode over tunnel — both devices share the
 * 100.x.x.x network and tunnel (ngrok) is slower and often unnecessary.
 */

import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_PORT = '8083';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    return null;
  }
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || '').trim();
}

function getTailscaleIp() {
  const ip = run('tailscale', ['ip', '-4']);
  if (ip && /^100\./.test(ip)) {
    return ip;
  }
  return null;
}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }
      candidates.push(entry.address);
    }
  }

  // Prefer Tailscale CGNAT range when present in interface list.
  const tailscaleCandidate = candidates.find((ip) => ip.startsWith('100.'));
  if (tailscaleCandidate) {
    return tailscaleCandidate;
  }

  // Skip typical Docker/virtual bridge ranges.
  const preferred = candidates.find(
    (ip) =>
      !ip.startsWith('172.17.') &&
      !ip.startsWith('172.18.') &&
      !ip.startsWith('192.168.122.')
  );

  return preferred || candidates[0] || null;
}

function resolveHostname() {
  if (process.env.REACT_NATIVE_PACKAGER_HOSTNAME) {
    return process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
  }

  const tailscaleIp = getTailscaleIp();
  if (tailscaleIp) {
    return tailscaleIp;
  }

  return getLanIp();
}

function parseArgs(argv) {
  const passthrough = [];
  let port = process.env.EXPO_PORT || DEFAULT_PORT;
  let mode = 'lan';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--tunnel') {
      mode = 'tunnel';
      passthrough.push(arg);
      continue;
    }

    if (arg === '--lan') {
      mode = 'lan';
      continue;
    }

    if (arg === '--port') {
      port = argv[i + 1] || port;
      passthrough.push(arg, port);
      i += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      port = arg.split('=')[1] || port;
      passthrough.push(arg);
      continue;
    }

    passthrough.push(arg);
  }

  if (!passthrough.some((arg) => arg === '--port' || arg.startsWith('--port='))) {
    passthrough.push('--port', port);
  }

  return { passthrough, port, mode };
}

const { passthrough, port, mode } = parseArgs(process.argv.slice(2));
const hostname = resolveHostname();

if (mode === 'lan' && !hostname) {
  console.error('\n❌ Kunde inte hitta ett nätverks-IP.');
  console.error('   Sätt manuellt: REACT_NATIVE_PACKAGER_HOSTNAME=100.x.x.x npm start');
  console.error('   Eller prova tunnel: npm run start:tunnel\n');
  process.exit(1);
}

const env = {
  ...process.env,
};

if (mode === 'lan' && hostname) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = hostname;
  // Ensure dev server binds on all interfaces (required for Tailscale).
  env.EXPO_DEVTOOLS_LISTEN_ADDRESS = '0.0.0.0';
}

console.log('\n📱 EventPulse Expo');
console.log(`   Mode: ${mode}`);
if (mode === 'lan' && hostname) {
  console.log(`   Host: ${hostname}:${port}`);
  console.log(`   QR / manuell URL: exp://${hostname}:${port}`);
  console.log(`   Test i telefonens Safari: http://${hostname}:${port}/status`);
  console.log('   (ska visa "packager-status:running" när Metro körs)');
  console.log('');
  console.log('   Om Expo Go fastnar på "Opening project...":');
  console.log('   1. Testa Safari-URL ovan — om den failar → brandvägg/Tailscale');
  console.log('   2. macOS Brandvägg → tillåt inkommande för Node');
  console.log('   3. I Expo Go: "Enter URL manually" → klistra in exp://-URL ovan');
  console.log('   4. Kör: npm run check:expo (medan Metro körs)\n');
} else {
  console.log('   Tunnel-läge (ngrok) — långsammare men fungerar utan delat nät.\n');
}

const expoArgs = ['expo', 'start', ...passthrough];
if (mode === 'lan') {
  expoArgs.push('--lan');
}

const child = spawn('npx', expoArgs, {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Failed to start Expo:', error.message);
  process.exit(1);
});
