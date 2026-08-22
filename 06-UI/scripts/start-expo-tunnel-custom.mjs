#!/usr/bin/env node
/**
 * Fallback tunnel when Expo's built-in `expo start --tunnel` fails.
 *
 * Requires a free ngrok authtoken:
 * https://dashboard.ngrok.com/get-started/your-authtoken
 *
 * Usage:
 * Uses EXPO_PACKAGER_PROXY_URL so Expo Go connects via ngrok over the internet.
 * (Expo's internal --lan flag here does NOT mean you need local LAN.)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.EXPO_PORT || 8081);

async function startNgrok(port) {
  let ngrok;
  try {
    ngrok = await import('@ngrok/ngrok');
  } catch {
    console.error('\n❌ @ngrok/ngrok saknas. Kör: npm install');
    process.exit(1);
  }

  if (!process.env.NGROK_AUTHTOKEN) {
    console.error('\n❌ NGROK_AUTHTOKEN saknas.');
    console.error('   Skapa gratis token: https://dashboard.ngrok.com/get-started/your-authtoken');
    console.error('   Kör: NGROK_AUTHTOKEN=xxx npm run start:tunnel:custom\n');
    process.exit(1);
  }

  const listener = await ngrok.forward({
    addr: port,
    authtoken_from_env: true,
  });

  const url = listener.url();
  if (!url) {
    throw new Error('ngrok did not return a public URL');
  }

  return {
    url: url.replace(/\/$/, ''),
    close: () => listener.close(),
  };
}

console.log('\n📱 EventPulse Expo — custom ngrok tunnel');
console.log(`   Port: ${PORT}`);

let ngrokHandle;
try {
  ngrokHandle = await startNgrok(PORT);
} catch (error) {
  console.error('\n❌ ngrok failed:', error.message);
  process.exit(1);
}

const proxyUrl = ngrokHandle.url;
const expoHost = new URL(proxyUrl).host;

console.log(`   Proxy URL: ${proxyUrl}`);
console.log(`   Expo Go URL: exp://${expoHost}`);
console.log('   Startar Metro med proxy...\n');

const expo = spawn(
  'npx',
  ['expo', 'start', '--lan', '--port', String(PORT)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      EXPO_PACKAGER_PROXY_URL: proxyUrl,
      EXPO_DEVTOOLS_LISTEN_ADDRESS: '0.0.0.0',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await ngrokHandle.close();
  } catch {}
  expo.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
expo.on('exit', (code) => shutdown(code ?? 0));
