import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { appendDiscoveryUiQueueEntry } from './discoveryUiQueue.js';
import { attachEventUrlToSourceFile } from '../../../02-Ingestion/tools/eventUrls.js';
import type { PromotionInput, SandboxSource, SourceCandidate, SourceCandidateWinningPath } from './types.js';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function canonicalUrl(url: string): string {
  const parsed = new URL(url.trim());
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

export function sourceIdForCandidate(candidate: SourceCandidate): string {
  const nameSlug = slugify(candidate.sourceName ?? new URL(candidate.candidateUrl).hostname);
  return `candidate-${candidate.id.slice(0, 8)}-${nameSlug || 'source'}`;
}

function sourceRecord(
  sourceId: string,
  candidate: SourceCandidate,
  options: {
    sandbox: boolean;
    preferredPath: SourceCandidateWinningPath | 'unknown';
    preferredPathReason: string;
    testRunId?: string;
    evidenceSummary?: string;
  },
): Record<string, unknown> {
  return {
    id: sourceId,
    url: candidate.candidateUrl.trim(),
    name: candidate.sourceName ?? sourceId,
    type: 'event_source',
    city: candidate.city ?? undefined,
    discoveredAt: new Date().toISOString(),
    discoveredBy: 'venue_graph',
    preferredPath: options.preferredPath,
    preferredPathReason: options.preferredPathReason,
    verifiedAt: options.sandbox ? undefined : new Date().toISOString(),
    metadata: {
      // Kandidatens metadata först — den innehåller källans egen konfiguration
      // (t.ex. adapter-inställningar) och ska inte försvinna i promote.
      ...(candidate.metadata ?? {}),
      sourceCandidateId: candidate.id,
      originPath: candidate.originPath,
      evidenceRefs: candidate.evidenceRefs,
      sandbox: options.sandbox,
      ...(options.testRunId ? { testRunId: options.testRunId } : {}),
      ...(options.evidenceSummary ? { evidenceSummary: options.evidenceSummary } : {}),
    },
  };
}

export function createSandboxSource(root: string, candidate: SourceCandidate): SandboxSource {
  const sourceId = sourceIdForCandidate(candidate);
  const sourcesDir = path.join(root, 'sources');
  mkdirSync(sourcesDir, { recursive: true });
  const sourcePath = path.join(sourcesDir, `${sourceId}.jsonl`);
  const record = sourceRecord(sourceId, candidate, {
    sandbox: true,
    preferredPath: 'unknown',
    preferredPathReason: 'source candidate sandbox test',
  });
  writeFileSync(sourcePath, `${JSON.stringify(record)}\n`, 'utf8');
  return { sourceId, sourcePath };
}

export function removeSandboxSource(root: string, sourceId: string): void {
  rmSync(path.join(root, 'sources', `${sourceId}.jsonl`), { force: true });
}

export function hasCanonicalSourceUrl(root: string, candidateUrl: string, candidateId?: string): boolean {
  const sourcesDir = path.join(root, 'sources');
  if (!existsSync(sourcesDir)) return false;
  const target = canonicalUrl(candidateUrl);
  for (const fileName of readdirSync(sourcesDir)) {
    if (!fileName.endsWith('.jsonl')) continue;
    const content = readFileSync(path.join(sourcesDir, fileName), 'utf8').trim();
    if (!content) continue;
    const existing = JSON.parse(content);
    if (existing?.metadata?.sandbox) continue;
    // En egen post från en tidigare promote är inte en dubblett — annars kan
    // en kandidat aldrig uppdatera sin egen rad (city, namn, preferredPath).
    if (candidateId && existing?.metadata?.sourceCandidateId === candidateId) continue;
    if (existing?.url && canonicalUrl(String(existing.url)) === target) return true;
  }
  return false;
}

function sameCanonicalUrl(sourcePath: string, candidateUrl: string): boolean {
  if (!existsSync(sourcePath)) return true;
  const existing = JSON.parse(readFileSync(sourcePath, 'utf8').trim());
  return canonicalUrl(String(existing.url)) === canonicalUrl(candidateUrl);
}

export function promoteSourceCandidate(
  root: string,
  candidate: SourceCandidate,
  promotion: PromotionInput,
): string | null {
  const sourcesDir = path.join(root, 'sources');
  const runtimeDir = path.join(root, 'runtime');
  mkdirSync(sourcesDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  // Första promote:en av en domän får det snygga domän-slug:et.
  //
  // 2026-10-24 — en FÖLJANDE URL på samma domän blir INTE en egen källa.
  // Den läggs som en extra event-sida på värdkällan (metadata.eventUrls).
  //
  // Tidigare skapades en egen `candidate-<hash>-<slug>.jsonl` per URL. Det gav
  // 25 extra källfiler för 9 värdar, 67 DB-rader där samma evenemang låg under
  // flera source-namn, och varje kandidat kördes genom hela C-gaten var för
  // sig — där C0 hittade samma värdnivå-vinnare (t.ex. /jobba-hos-oss på
  // operan.se) för dem alla.
  //
  // Nu är kandidaten en SIDA av samma venue. C-gaten extraherar den sidan
  // för sig och slår ihop raderna med huvudkörningen.
  const primaryId = slugify(candidate.sourceName ?? new URL(candidate.candidateUrl).hostname);
  let sourceId = primaryId || sourceIdForCandidate(candidate);
  const primaryPath = path.join(sourcesDir, `${sourceId}.jsonl`);
  if (existsSync(primaryPath) && !sameCanonicalUrl(primaryPath, candidate.candidateUrl)) {
    const attached = attachEventUrlToSourceFile(primaryPath, candidate.candidateUrl.trim());
    if (attached) {
      console.log(
        `[promote] ${sourceId}: kandidatens URL lades som extra event-sida — ${candidate.candidateUrl}`,
      );
      appendDiscoveryUiQueueEntry(root, {
        sourceId,
        sourceCandidateId: candidate.id,
        testRunId: promotion.testRunId,
        name: candidate.sourceName ?? sourceId,
        url: candidate.candidateUrl.trim(),
        city: candidate.city ?? null,
        promotedAt: new Date().toISOString(),
        discoveredBy: 'venue_graph',
        preferredPath: promotion.preferredPath,
        evidenceSummary: promotion.evidenceSummary,
        status: 'promoted_to_sources',
      });
      return sourceId;
    }
    // Kunde inte bifoga (ogiltig URL) — fall tillbaka på egen källa.
    sourceId = sourceIdForCandidate(candidate);
  }

  const sourcePath = path.join(sourcesDir, `${sourceId}.jsonl`);
  if (existsSync(sourcePath) && !sameCanonicalUrl(sourcePath, candidate.candidateUrl)) {
    // Slug-kollision som överlever fallbacken (t.ex. kandidaten promote:ades
    // tidigare under ett annat namn). Före 2026-10-21 kastade detta och dödade
    // hela batchen — nu avbryts bara den här kandidaten.
    console.warn(`[promote] slug collision for ${sourceId} (${candidate.candidateUrl}) — skipping, source not written`);
    return null;
  }

  const record = sourceRecord(sourceId, candidate, {
    sandbox: false,
    preferredPath: promotion.preferredPath,
    preferredPathReason: promotion.preferredPathReason,
    testRunId: promotion.testRunId,
    evidenceSummary: promotion.evidenceSummary,
  });
  writeFileSync(sourcePath, `${JSON.stringify(record)}\n`, 'utf8');
  appendDiscoveryUiQueueEntry(root, {
      sourceId,
      sourceCandidateId: candidate.id,
      testRunId: promotion.testRunId,
      name: candidate.sourceName ?? sourceId,
      url: candidate.candidateUrl.trim(),
      city: candidate.city ?? null,
      promotedAt: new Date().toISOString(),
      discoveredBy: 'venue_graph',
      preferredPath: promotion.preferredPath,
      evidenceSummary: promotion.evidenceSummary,
      status: 'promoted_to_sources',
  });
  return sourceId;
}
