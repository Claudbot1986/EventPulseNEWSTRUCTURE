/**
 * Tests för handoff-som-icke-fel i status-maskinen.
 *
 * Bakgrund (2026-10-24). B-gaten lämnar över en källa till C-gaten genom
 * `addToPostBPreCQueue()`, som skriver `success: false` UTAN error-sträng.
 * sourceRegistry.updateSourceStatus() föll då till generiska felgrenen:
 * status='fail', consecutiveFailures++ → maybeAutoQuarantine() vid tröskeln 5.
 * Källan försvann alltså ur pipelinen INNAN C-gaten ens körde den — 56
 * källor karantänades under en enda natt (INDEX 240 → 296 rader).
 *
 * Vad testen bevisar:
 *   1. En handoff (pendingNextTool satt) ger status 'routed', räknar inte
 *      consecutiveFailures och kan ALDRIG auto-quarantenas — hur många
 *      körningar som helst.
 *   2. Negativ kontroll: ett verkligt fel räknas fortfarande och
 *      auto-quarantenas vid 5 — kontrollen kan alltså faila.
 *   3. De äldre pending_*-statusarna (pending_render_gate m.fl.) räknas inte
 *      som fel heller — de betyder "väntar på annan gate".
 *
 * Sandbox via EVENTPULSE_SANDBOX_ROOT — inga skrivningar utanför tmpdir.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const sandbox = mkdtempSync(join(tmpdir(), 'source-registry-handoff-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

import * as reg from './sourceRegistry.js';

function freshFixture(testName: string): { sourceId: string; sourceFile: string; quarantineFile: string } {
  const sourceId = `${testName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceFile = join(sandbox, 'sources', `${sourceId}.jsonl`);
  const quarantineFile = join(sandbox, 'sources/_quarantine', `${sourceId}.jsonl`);
  writeFileSync(
    sourceFile,
    JSON.stringify({
      id: sourceId,
      url: `https://${testName}.example.com`,
      name: sourceId,
      type: 'venue',
      city: 'Stockholm',
      discoveredAt: '2026-09-10',
    }) + '\n',
    'utf8',
  );
  return { sourceId, sourceFile, quarantineFile };
}

function quarantineEntries(): Array<{ sourceId?: string }> {
  const raw = readFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

describe('sourceRegistry handoff är inte ett fel', () => {
  beforeEach(() => {
    mkdirSync(join(sandbox, 'sources'), { recursive: true });
    mkdirSync(join(sandbox, 'sources/_quarantine'), { recursive: true });
    mkdirSync(join(sandbox, 'runtime'), { recursive: true });
    writeFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), '[]\n');
  });

  it('handoff ger status routed, räknar inte fel och karantäneras aldrig', () => {
    const fx = freshFixture('handoff');

    for (let i = 0; i < 8; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        preferredPath: 'html',
        ingestionStage: 'B',
        pendingNextTool: 'C-htmlGate',
        lastRoutingReason: `postB-preC: ${i}`,
        lastRoutingSource: 'runtime_status',
      });
    }

    const status = reg.getSourceStatus(fx.sourceId);
    expect(status.status).toBe('routed');
    expect(status.consecutiveFailures).toBe(0);
    expect(existsSync(fx.sourceFile)).toBe(true);
    expect(existsSync(fx.quarantineFile)).toBe(false);
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(0);
  });

  it('NEGATIV KONTROLL: verkligt fel räknas och karantänenas vid 5', () => {
    const fx = freshFixture('failure');

    for (let i = 0; i < 5; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        ingestionStage: 'failed',
        error: 'Fetch failed: timeout of 20000ms exceeded',
      });
    }

    const status = reg.getSourceStatus(fx.sourceId);
    expect(status.status).toBe('fail');
    expect(status.consecutiveFailures).toBe(5);
    expect(existsSync(fx.quarantineFile)).toBe(true);
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(1);
  });

  it('pending_render_gate räknas inte som fel', () => {
    const fx = freshFixture('pending-render');

    for (let i = 0; i < 8; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        ingestionStage: 'D',
        error: 'pending_render_gate: waiting for D-renderGate',
      });
    }

    const status = reg.getSourceStatus(fx.sourceId);
    expect(status.status).toBe('pending_render_gate');
    expect(status.consecutiveFailures).toBe(0);
    expect(existsSync(fx.quarantineFile)).toBe(false);
  });

  it('en handoff efter ett verkligt fel triggar inte karantän', () => {
    const fx = freshFixture('mixed');

    // 4 verkliga fel — under tröskeln.
    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        ingestionStage: 'failed',
        error: 'Fetch failed: timeout',
      });
    }
    expect(reg.getSourceStatus(fx.sourceId).consecutiveFailures).toBe(4);

    // En handoff ska INTE kunna trigga karantän på den redan höga räknaren.
    reg.updateSourceStatus(fx.sourceId, {
      success: false,
      eventsFound: 0,
      preferredPath: 'html',
      ingestionStage: 'B',
      pendingNextTool: 'C-htmlGate',
      lastRoutingReason: 'postB-preC: routed',
      lastRoutingSource: 'runtime_status',
    });

    expect(reg.getSourceStatus(fx.sourceId).status).toBe('routed');
    expect(existsSync(fx.quarantineFile)).toBe(false);
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(0);
  });

  it('en handoff nollställer felräknaren — den räknar CONSECUTIVA fel', () => {
    // Motiv (2026-10-24): momentsapp.no samlade fem 429-fel i A-gaten och
    // blev auto-karantänad. Bot-väggen är nu en handoff. Om räknaren inte
    // nollställs vid handoffen begravs källan omedelbart vid nästa verkliga
    // fel — trots att den aldrig begått någon gate om att begrava den.
    const fx = freshFixture('reset');

    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        ingestionStage: 'failed',
        error: 'Fetch failed: HTTP 429',
      });
    }
    expect(reg.getSourceStatus(fx.sourceId).consecutiveFailures).toBe(4);

    // Handoff (bot-vägg → nästa gate) bryter kedjan av konsekutiva fel.
    reg.updateSourceStatus(fx.sourceId, {
      success: false,
      eventsFound: 0,
      preferredPath: 'html',
      ingestionStage: 'B',
      pendingNextTool: 'B-JSON-feedGate',
      lastRoutingReason: 'toolA(preA): Fetch failed: HTTP 429',
      lastRoutingSource: 'runtime_status',
    });
    expect(reg.getSourceStatus(fx.sourceId).consecutiveFailures).toBe(0);

    // 4 nya fel räcker fortfarande inte för att begrava källan.
    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false,
        eventsFound: 0,
        ingestionStage: 'failed',
        error: 'Fetch failed: HTTP 429',
      });
    }
    expect(reg.getSourceStatus(fx.sourceId).consecutiveFailures).toBe(4);
    expect(existsSync(fx.quarantineFile)).toBe(false);
  });
});
