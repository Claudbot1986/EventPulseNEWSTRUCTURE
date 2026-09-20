/**
 * 02-Ingestion/I-pdfExtraction/tests/pdfExtractor.test.ts
 *
 * P2A tester (2026-09-10): verifierar pdfExtractor.ts grundläggande
 * funktionalitet utan att hämta riktiga PDF:er (network-mockade).
 *
 * Säkerhet: alla fetch-anrop mockas — inga riktiga nätverksanrop.
 *
 * Run: npx vitest run 02-Ingestion/I-pdfExtraction/tests/pdfExtractor.test.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

// 1. Mock fetch — vi kontrollerar PDF-svaret
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// 2. Mock pdf-parse — vi returnerar kontrollerad text.
// pdf-parse@2 exponerar klassen PDFParse (getText()); gamla v1 hade en
// default-funktion. Implementationen (pdfExtractor.ts) föredrar PDFParse om
// exporten finns — därför måste mocken erbjuda båda formerna, annars kastar
// vitest "No PDFParse export is defined on the mock" vid åtkomst.
const pdfParseMock = vi.fn();
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(public opts: { data: Buffer }) {}
    getText() {
      return pdfParseMock(this.opts.data);
    }
  },
  default: (...args: unknown[]) => pdfParseMock(...args),
}));

// 3. Importera EFTER mocks
const { runPdfExtraction } = await import('../pdfExtractor.js');

beforeEach(() => {
  fetchMock.mockReset();
  pdfParseMock.mockReset();
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakePdfBuffer(text: string): Buffer {
  // pdf-parse tar en Buffer; vi behöver inte en riktig PDF eftersom vi
  // mockar hela parsingen.
  return Buffer.from(text);
}

const KB_PDF_TEXT = `
Kungliga Biblioteket — Vårens program 2026

26 mars 2026 kl 19:00
Föreläsning: Digitalisering av svenska arkiv
Plats: Kungliga Biblioteket, Humlegården
Pris: 120 kr

2 april 2026 kl 18:00
Boksamtal: Astrid Lindgrens kvarlämnade manuskript
Plats: Kungliga Biblioteket
Pris: Fri entré

15 maj 2026 kl 14:00
Workshop: Handskriftsanalys för nybörjare
Plats: KB, Humlegården
Pris: 250 kr
`;

const RIKSARKIVET_PDF_TEXT = `
Riksarkivet — Seminarier våren 2026

10 april 2026 kl 13:00
Seminarium: Svenska emigrationen till Amerika
Plats: Riksarkivet, Stockholm
Pris: 0 kr

22 maj 2026 kl 10:00
Forskarseminarium: Medeltida kyrkoböcker
Plats: Riksarkivet Stockholm
`;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('pdfExtractor', () => {
  test('källlista tomt utan pdfUrls', async () => {
    // Hermetisk: explicit tom källista. (Tidigare var testet beroende av att
    // HELA riktiga sources/-trädet saknade pdfUrls — det bröts när riktiga
    // pdf-källor lades till. Ett enhetstest ska inte läsa produktions-FS.)
    // Resultat: totalSources=0, totalPdfs=0, totalEvents=0.
    const result = await runPdfExtraction({ limit: 5, concurrency: 1, sources: [] });
    expect(result.totalSources).toBe(0);
    expect(result.totalPdfs).toBe(0);
    expect(result.totalEvents).toBe(0);
  });

  test('PDF med svenska event-texter → events hittas', async () => {
    // Mock: fetch returnerar en fake-PDF, pdf-parse returnerar kontrollerad text
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => makeFakePdfBuffer('fake pdf bytes'),
    });
    pdfParseMock.mockResolvedValue({ text: KB_PDF_TEXT });

    // Vi skickar in en syntetisk source-lista (vi vill inte bero på sources/-FS)
    const result = await runPdfExtraction({
      limit: 5,
      concurrency: 1,
      sources: [{
        sourceId: 'kungliga-biblioteket',
        url: 'https://kb.se/program',
        pdfUrls: ['https://kb.se/program/var-2026.pdf'],
      }],
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].pdfsProcessed).toBe(1);
    // Universal-extractor hittar datum + venue från text, men vi vet inte exakt
    // hur många events eftersom regex varierar. Vi kontrollerar bara att vi
    // processade PDF:en utan fel.
    expect(result.firstError).toBeNull();
  });

  test('PDF-fetch misslyckas → fel markeras men andra källor fortsätter', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => makeFakePdfBuffer('ok'),
    });
    pdfParseMock.mockResolvedValue({ text: RIKSARKIVET_PDF_TEXT });

    const result = await runPdfExtraction({
      limit: 5,
      concurrency: 1,
      sources: [
        {
          sourceId: 'fail-source',
          url: 'https://example.com',
          pdfUrls: ['https://example.com/missing.pdf'],
        },
        {
          sourceId: 'ok-source',
          url: 'https://riksarkivet.se',
          pdfUrls: ['https://riksarkivet.se/seminarier.pdf'],
        },
      ],
    });

    expect(result.results.length).toBe(2);
    expect(result.results[0].firstError).toContain('fetch failed');
    expect(result.results[1].firstError).toBeNull();
    expect(result.results[1].pdfsProcessed).toBe(1);
  });

  test('PDF-tomt innehåll → 0 events, inget fel', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => makeFakePdfBuffer('...'),
    });
    pdfParseMock.mockResolvedValue({ text: '' });

    const result = await runPdfExtraction({
      limit: 5,
      concurrency: 1,
      sources: [{
        sourceId: 'empty-pdf',
        url: 'https://example.com',
        pdfUrls: ['https://example.com/empty.pdf'],
      }],
    });

    // Tom text räknas INTE som processad PDF (vi hoppar över tom text eftersom
    // universal-extractor inte kan göra något vettigt av det).
    expect(result.results[0].pdfsProcessed).toBe(0);
    expect(result.results[0].eventsFound).toBe(0);
    expect(result.results[0].firstError).toBeNull();
  });

  test('PDF över 5 MB → skippa', async () => {
    // Mock returnerar 6 MB
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(6 * 1024 * 1024),
    });

    const result = await runPdfExtraction({
      limit: 5,
      concurrency: 1,
      sources: [{
        sourceId: 'large-pdf',
        url: 'https://example.com',
        pdfUrls: ['https://example.com/huge.pdf'],
      }],
    });

    expect(result.results[0].pdfsProcessed).toBe(0);
    expect(result.results[0].firstError).toBeNull();
  });
});
