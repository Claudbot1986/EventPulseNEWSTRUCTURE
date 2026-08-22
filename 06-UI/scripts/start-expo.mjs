#!/usr/bin/env node
/**
 * Start Expo dev server. Default: tunnel (works over the internet, no LAN).
 * Use --lan only for local network / Tailscale development.
 */

import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_PORT = '8083';
const TUNNEL_PORT = '8081'; // Expo tunnel requires 8081 for @expo/ws-tunnel fallback + ngrok compat

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
  let mode = 'tunnel';
  let port = process.env.EXPO_PORT || TUNNEL_PORT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--tunnel') {
      mode = 'tunnel';
      port = TUNNEL_PORT;
      passthrough.push(arg);
      continue;
    }

    if (arg === '--lan') {
      mode = 'lan';
      port = process.env.EXPO_PORT || DEFAULT_PORT;
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

  if (mode === 'tunnel' && !passthrough.includes('--tunnel')) {
    passthrough.push('--tunnel');
  }

  if (!passthrough.some((arg) => arg === '--port' || arg.startsWith('--port='))) {
    passthrough.push('--port', port);
  } else {
    // Sync parsed port if --port was passed through explicitly.
    const portIdx = passthrough.findIndex((arg) => arg === '--port');
    if (portIdx >= 0 && passthrough[portIdx + 1]) {
      port = passthrough[portIdx + 1];
    }
  }

  return { passthrough, port, mode };
}

const { passthrough, port, mode } = parseArgs(process.argv.slice(2));
const hostname = resolveHostname();

if (mode === 'lan' && !hostname) {
  console.error('\n❌ Kunde inte hitta ett nätverks-IP.');
  console.error('   Sätt manuellt: REACT_NATIVE_PACKAGER_HOSTNAME=100.x.x.x npm run start:lan\n');
  process.exit(1);
}

const env = {
  ...process.env,
};

if (mode === 'tunnel') {
  // Tunnel must not inherit LAN/Tailscale hostname — Expo uses ngrok URL instead.
  delete env.REACT_NATIVE_PACKAGER_HOSTNAME;
  delete env.EXPO_PACKAGER_PROXY_URL;
} else if (mode === 'lan' && hostname) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = hostname;
  // Ensure dev server binds on all interfaces (required for Tailscale).
  env.EXPO_DEVTOOLS_LISTEN_ADDRESS = '0.0.0.0';
}

console.log('\n📱 EventPulse Expo');
console.log(`   Mode: ${mode}`);
if (mode === 'tunnel') {
  console.log('   Tunnel-läge (ngrok via exp.direct) — port 8081');
  console.log('   Vänta tills du ser "Tunnel ready" innan du skannar QR');
  console.log('   QR-URL ska innehålla ".exp.direct" — inte localhost');
  console.log('');
  console.log('   Om tunnel failar:');
  console.log('   1. Döda gamla processer: pkill -f "expo start"');
  console.log('   2. Rensa cache: npx expo start --tunnel --port 8081 --clear');
  console.log('   3. Kontrollera: https://status.ngrok.com/');
  console.log('   4. Prova egen ngrok-token: NGROK_AUTHTOKEN=xxx npm run start:tunnel:custom\n');
} else if (mode === 'lan' && hostname) {
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
  console.log('   Okänt läge.\n');
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
