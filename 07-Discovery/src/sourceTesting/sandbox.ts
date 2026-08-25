import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { appendDiscoveryUiQueueEntry } from './discoveryUiQueue.js';
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

export function hasCanonicalSourceUrl(root: string, candidateUrl: string): boolean {
  const sourcesDir = path.join(root, 'sources');
  if (!existsSync(sourcesDir)) return false;
  const target = canonicalUrl(candidateUrl);
  for (const fileName of readdirSync(sourcesDir)) {
    if (!fileName.endsWith('.jsonl')) continue;
    const content = readFileSync(path.join(sourcesDir, fileName), 'utf8').trim();
    if (!content) continue;
    const existing = JSON.parse(content);
    if (existing?.metadata?.sandbox) continue;
    if (existing?.url && canonicalUrl(String(existing.url)) === target) return true;
  }
  return false;
}

export function promoteSourceCandidate(root: string, candidate: SourceCandidate, promotion: PromotionInput): string {
  const sourceId = slugify(candidate.sourceName ?? new URL(candidate.candidateUrl).hostname) || sourceIdForCandidate(candidate);
  const sourcesDir = path.join(root, 'sources');
  const runtimeDir = path.join(root, 'runtime');
  mkdirSync(sourcesDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  const sourcePath = path.join(sourcesDir, `${sourceId}.jsonl`);
  if (existsSync(sourcePath)) {
    const existing = JSON.parse(readFileSync(sourcePath, 'utf8').trim());
    if (canonicalUrl(String(existing.url)) !== canonicalUrl(candidate.candidateUrl)) {
      throw new Error(`Source id collision for ${sourceId}`);
    }
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
