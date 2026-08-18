import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { SourceCandidateWinningPath } from './types.js';

export interface DiscoveryUiQueueEntry {
  sourceId: string;
  sourceCandidateId: string;
  testRunId: string;
  name: string;
  url: string;
  city?: string | null;
  promotedAt: string;
  discoveredBy: 'venue_graph';
  preferredPath: SourceCandidateWinningPath;
  evidenceSummary: string;
  status: 'promoted_to_sources';
}

export interface AppendDiscoveryUiQueueOptions {
  maxActiveRows?: number;
}

const DEFAULT_MAX_ACTIVE_ROWS = 500;

export function discoveryUiQueuePath(root: string): string {
  return path.join(root, 'runtime', 'discovery-ui-queue.jsonl');
}

export function appendDiscoveryUiQueueEntry(
  root: string,
  entry: DiscoveryUiQueueEntry,
  options: AppendDiscoveryUiQueueOptions = {},
): void {
  const queuePath = discoveryUiQueuePath(root);
  mkdirSync(path.dirname(queuePath), { recursive: true });
  const existing = readDiscoveryUiQueueEntries(root);
  const duplicate = existing.some((row) =>
    row.sourceId === entry.sourceId || row.sourceCandidateId === entry.sourceCandidateId
  );
  if (duplicate) return;
  appendFileSync(
    queuePath,
    `${JSON.stringify(entry)}\n`,
    'utf8',
  );
  enforceDiscoveryUiRetention(root, options.maxActiveRows ?? DEFAULT_MAX_ACTIVE_ROWS);
}

export function readDiscoveryUiQueueEntries(root: string): DiscoveryUiQueueEntry[] {
  const queuePath = discoveryUiQueuePath(root);
  if (!existsSync(queuePath)) return [];
  return readFileSync(queuePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return isDiscoveryUiQueueEntry(row) ? [row] : [];
      } catch {
        return [];
      }
    });
}

function archivePathForEntry(root: string, entry: DiscoveryUiQueueEntry): string {
  const month = /^\d{4}-\d{2}/.test(entry.promotedAt) ? entry.promotedAt.slice(0, 7) : 'invalid-date';
  return path.join(root, 'runtime', 'archive', `discovery-ui-${month}.jsonl`);
}

function isDiscoveryUiQueueEntry(row: unknown): row is DiscoveryUiQueueEntry {
  if (!row || typeof row !== 'object') return false;
  const value = row as Record<string, unknown>;
  return (
    typeof value.sourceId === 'string' &&
    typeof value.sourceCandidateId === 'string' &&
    typeof value.testRunId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    typeof value.promotedAt === 'string' &&
    /^\d{4}-\d{2}/.test(value.promotedAt) &&
    value.discoveredBy === 'venue_graph' &&
    typeof value.preferredPath === 'string' &&
    typeof value.evidenceSummary === 'string' &&
    value.status === 'promoted_to_sources'
  );
}

function enforceDiscoveryUiRetention(root: string, maxActiveRows: number): void {
  if (maxActiveRows <= 0) return;
  const queuePath = discoveryUiQueuePath(root);
  if (!existsSync(queuePath)) return;

  const rawLines = readFileSync(queuePath, 'utf8')
    .split('\n')
    .filter(Boolean);
  const validRows = rawLines.flatMap((line, index) => {
    try {
      const row = JSON.parse(line);
      return isDiscoveryUiQueueEntry(row) ? [{ index, line, row }] : [];
    } catch {
      return [];
    }
  });
  if (validRows.length <= maxActiveRows) return;

  const archiveCount = validRows.length - maxActiveRows;
  const toArchive = validRows.slice(0, archiveCount);
  const archivedIndexes = new Set(toArchive.map((item) => item.index));

  for (const item of toArchive) {
    const archivePath = archivePathForEntry(root, item.row);
    mkdirSync(path.dirname(archivePath), { recursive: true });
    appendFileSync(archivePath, `${item.line}\n`, 'utf8');
  }

  const keptLines = rawLines.filter((_, index) => !archivedIndexes.has(index));
  writeFileSync(queuePath, keptLines.length ? `${keptLines.join('\n')}\n` : '', 'utf8');
}
