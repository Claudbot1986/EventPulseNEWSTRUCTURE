#!/usr/bin/env node
/**
 * Verify Expo dev server is reachable over Tailscale/LAN.
 * Run on the Mac while `npm start` is active in another terminal.
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

const PORT = Number(process.env.EXPO_PORT || process.env.PORT || 8083);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return null;
  }
  return (result.stdout || '').trim();
}

function getTailscaleIp() {
  const ip = run('tailscale', ['ip', '-4']);
  return ip && /^100\./.test(ip) ? ip : null;
}

function getLanIps() {
  const ips = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

function probeHost(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function probeHttp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve({ ok: response.ok || response.status === 200, status: response.status });
      })
      .catch((error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });
  });
}

const tailscaleIp = getTailscaleIp();
const lanIps = getLanIps();
const host = process.env.REACT_NATIVE_PACKAGER_HOSTNAME || tailscaleIp || lanIps.find((ip) => ip.startsWith('100.')) || lanIps[0];

console.log('\n🔍 EventPulse Expo connectivity check');
console.log(`   Port: ${PORT}`);

if (tailscaleIp) {
  console.log(`   Tailscale IP: ${tailscaleIp}`);
} else {
  console.log('   Tailscale IP: not detected (kör "tailscale ip -4" manuellt)');
}

if (host) {
  console.log(`   Expected host: ${host}`);
} else {
  console.log('   Expected host: unknown');
}

const localOpen = await probeHost('127.0.0.1', PORT);
const allInterfacesOpen = await probeHost('0.0.0.0', PORT);

console.log('\n📡 Local checks (på Mac):');
console.log(`   Metro lyssnar på localhost:${PORT}? ${localOpen ? '✅ ja' : '❌ nej — kör npm start först'}`);

if (!localOpen) {
  console.log('\n➡️  Starta Expo i 06-UI: npm start\n');
  process.exit(1);
}

const status = await probeHttp(`http://127.0.0.1:${PORT}/status`);
console.log(`   Metro /status svarar? ${status.ok ? '✅ ja' : '❌ nej'}`);

console.log('\n📱 Testa från telefon (Safari):');
if (host) {
  console.log(`   http://${host}:${PORT}/status`);
  console.log(`   Förväntat: svar "packager-status:running"`);
  console.log(`\n   Expo Go manuell URL:`);
  console.log(`   exp://${host}:${PORT}`);
}

console.log('\n🛡️  Om Safari-testet misslyckas på telefonen:');
console.log('   1. macOS → Systeminställningar → Nätverk → Brandvägg');
console.log('   2. Tillåt inkommande anslutningar för Node');
console.log(`   3. Eller: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)`);
console.log(`   4. Säkerställ att Tailscale är "Connected" på både Mac och iPhone`);
console.log(`   5. Starta om Expo efter brandväggsändring: npm start\n`);

process.exit(localOpen && status.ok ? 0 : 1);
