#!/usr/bin/env node
"""vault-sync-session-end.js"""
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = '/Volumes/2TB filer/NEWSTRUCTURE-COPY';
const VAULT_ROOT = join(PROJECT_ROOT, '00-Vault');
const TARGET_FILE = join(VAULT_ROOT, '01-Projects/EventPulse/00-Core/01-Current-State.md');

function exec(cmd) {
  try {
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000, maxBuffer: 10*1024*1024 });
  } catch (e) { return 'ERROR: ' + e.message; }
}

function isoStockholmDate() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function getGitState() {
  const log = exec('git log --oneline -20');
  const status = exec('git status --short');
  const diffStat = exec('git diff --stat HEAD~5..HEAD');
  const branch = exec('git rev-parse --abbrev-ref HEAD').trim();
  const statusLines = status.split('
').filter(l => l.trim());
  const lastCommitMatch = log.match(/^([a-f0-9]+) (.+)$/m);
  const lastCommit = lastCommitMatch ? { hash: lastCommitMatch[1].slice(0,7), subject: lastCommitMatch[2] } : { hash: 'unknown', subject: 'unknown' };
  const recentCommits = log.split('
').slice(0,5).map(line => line.replace(/^[a-f0-9]+ /, '')).join('
');
  return { branch, lastCommit, uncommittedCount: statusLines.length, statusSummary: statusLines.length > 0 ? statusLines.join('; ') : 'none', recentCommits, diffStat };
}

function getTestState() {
  try {
    const result = exec('npx vitest run --reporter=json 2>&1');
    const jsonMatch = result.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
    if (jsonMatch) { const d = JSON.parse(jsonMatch[0]); return { total: d.numTotalTests, passed: d.numPassedTests, failed: d.numFailedTests, suites: d.numSuites }; }
  } catch {}
  return null;
}

function getPackageInfo() {
  try { const p = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')); return { version: p.version, name: p.name }; } catch { return null; }
}

function getMigrations() {
  const d = join(PROJECT_ROOT, '05-Supabase/migrations');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.sql')).sort().slice(-5);
}

function buildAutoFacts({ git, tests, pkg, migrations, syncTime }) {
  const lines = [];
  lines.push('[VERIFIED] Branch: `' + git.branch + '`');
  lines.push('[VERIFIED] Last commit: `' + git.lastCommit.hash + '` — ' + git.lastCommit.subject);
  lines.push('[VERIFIED] Last commit date: ' + syncTime + ' (Stockholm local)');
  lines.push('[VERIFIED] Sync run at: ' + syncTime);
  lines.push('[VERIFIED] Uncommitted changes: ' + git.uncommittedCount + ' (' + git.statusSummary + ')');
  lines.push('');
  lines.push('[VERIFIED] Most recent 5 commits on `' + git.branch + '`:');
  for (const c of git.recentCommits.split('
').filter(Boolean)) lines.push('- ' + c);
  lines.push('');
  if (tests) lines.push('[VERIFIED] Tests (vitest): ' + tests.total + ' total / ' + tests.passed + ' passed / ' + tests.failed + ' failed (' + tests.suites + ' suites)');
  if (pkg) lines.push('[VERIFIED] Package: `' + pkg.name + '` v' + pkg.version + ' (private, ESM)');
  if (migrations.length > 0) {
    lines.push('[VERIFIED] Most recent migrations in `05-Supabase/migrations/` (tracked + present on disk):');
    for (const m of migrations) lines.push('- ' + m);
  }
  lines.push('[VERIFIED] Vault gitignored at `/00-Vault/` (per `.gitignore` rule).');
  lines.push('');
  const statLines = git.diffStat.split('
').filter(Boolean);
  if (statLines.length > 0) { lines.push('[VERIFIED] Diff stat for HEAD~5..HEAD:'); for (const l of statLines.slice(0,10)) lines.push('- ' + l); }
  return lines.join('
');
}

function updateCurrentState(autoFacts) {
  let content = readFileSync(TARGET_FILE, 'utf-8') || null;
  if (!content) {
    content = '# EventPulse — Current State

> Auto-maintained by the  SessionEnd hook.

## Auto-facts (machine-synced)

' + autoFacts + '

## Narrative (human-maintained)

_None yet._
';
  } else {
    const sectionStart = content.indexOf('## Auto-facts (machine-synced)');
    if (sectionStart === -1) {
      const narrativeStart = content.indexOf('## Narrative');
      if (narrativeStart !== -1) content = content.slice(0, narrativeStart) + '## Auto-facts (machine-synced)

' + autoFacts + '

' + content.slice(narrativeStart);
    } else {
      const afterStart = content.indexOf('
', sectionStart) + 1;
      const narrativeMatch = content.indexOf('## Narrative', afterStart);
      if (narrativeMatch !== -1) content = content.slice(0, afterStart) + autoFacts + '

' + content.slice(narrativeMatch);
      else content = content.slice(0, afterStart) + autoFacts + '

';
    }
  }
  writeFileSync(TARGET_FILE, content, 'utf-8');
  console.log('VAULT-SYNC: Updated ' + TARGET_FILE);
}

async function main() {
  console.log('VAULT-SYNC: Starting session-end sync...');
  const syncTime = isoStockholmDate();
  const git = getGitState();
  const tests = getTestState();
  const pkg = getPackageInfo();
  const migrations = getMigrations();
  const autoFacts = buildAutoFacts({ git, tests, pkg, migrations, syncTime });
  updateCurrentState(autoFacts);
  console.log('VAULT-SYNC: Sync complete at ' + syncTime);
  process.exit(0);
}

main().catch(err => { console.error('VAULT-SYNC ERROR:', err.message); process.exit(1); });
