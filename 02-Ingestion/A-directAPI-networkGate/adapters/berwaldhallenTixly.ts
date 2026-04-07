/**
 * Berwaldhallen Tixly API Fetcher
 * Fetches events from the discovered /api/services/tixly/data endpoint
 *
 * Discovery: networkInspector found this endpoint returning
 * {"Events":[{...}], "Productions":[{...}]} with real event data.
 */

const TIXLY_API_URL = 'https://www.berwaldhallen.se/api/services/tixly/data';

/**
 * Fetch and map Berwaldhallen events from Tixly API
 *
 * The API returns:
 * - Events[]: flat list of occurrences (one per date/time combination)
 * - Productions[]: metadata including description per EventGroupId
 *
 * We deduplicate by EventGroupId to get one canonical event per production.
 */
export async function fetchBerwaldhallenTixlyEvents(): Promise<any[]> {
  const response = await fetch(TIXLY_API_URL, {
    headers: {
      'User-Agent': 'EventPulse/1.0',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Tixly API returned ${response.status}`);
  }

  const data = await response.json() as {
    Events?: Array<{
      EventGroupId: number;
      EventId: number;
      Name: string;
      PurchaseUrl: string;
      WaitingList: boolean;
      State: { SoldOut: boolean; SaleStatusText: string; OnlineSaleStart: string };
      StartDateTimezone: string;
      StartDate: string;
      EndDate: string;
      MinPrice: number;
      MaxPrice: number;
    }>;
    Productions?: Array<{
      EventGroupId: number;
      Name: string;
      Description?: string;
    }>;
  };

  const events = data.Events ?? [];
  const productions = data.Productions ?? [];

  // Build a map of EventGroupId -> Production description
  const productionMap = new Map<number, string>();
  for (const p of productions) {
    productionMap.set(p.EventGroupId, p.Description ?? '');
  }

  // Deduplicate by EventGroupId (take first occurrence = earliest date)
  const seen = new Set<number>();
  const deduped: Array<{
    EventGroupId: number;
    EventId: number;
    Name: string;
    Description: string;
    PurchaseUrl: string;
    SoldOut: boolean;
    SaleStatusText: string;
    OnlineSaleStart: string;
    StartDate: string;
    EndDate: string;
    MinPrice: number;
    MaxPrice: number;
  }> = [];

  for (const ev of events) {
    if (seen.has(ev.EventGroupId)) continue;
    seen.add(ev.EventGroupId);
    deduped.push({
      ...ev,
      Description: productionMap.get(ev.EventGroupId) ?? '',
    });
  }

  return deduped.map(ev => mapTixlyEvent(ev));
}

function mapTixlyEvent(ev: {
  EventGroupId: number;
  EventId: number;
  Name: string;
  Description: string;
  PurchaseUrl: string;
  SoldOut: boolean;
  SaleStatusText: string;
  OnlineSaleStart: string;
  StartDate: string;
  EndDate: string;
  MinPrice: number;
  MaxPrice: number;
}): {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  start_time: string;
  end_time: string;
  venue: string;
  area: string;
  address: string;
  category: string;
  url: string;
  image_url: null;
  price_info: string | null;
  promoter: null;
  organizer: null;
  accessibility: null;
  age_restriction: null;
  tags: string[];
  raw_data: Record<string, unknown>;
} {
  // Preserve original timezone from StartDate (format: "2026-10-24T12:00:00" in +02:00)
  // Extract date and time from the ISO string directly without Date conversion
  const date = ev.StartDate.split('T')[0];
  const time = ev.StartDate.split('T')[1]?.substring(0, 5) ?? '';

  // Use the original ISO string with timezone as start_time
  const start_time = ev.StartDate;
  const end_time = ev.EndDate || '';

  const isFree = ev.MinPrice === 0;
  const priceInfo = isFree
    ? 'Gratis'
    : ev.MinPrice === ev.MaxPrice
      ? `${ev.MinPrice} kr`
      : `${ev.MinPrice}–${ev.MaxPrice} kr`;

  const category = inferCategory(ev.Name, ev.Description);

  return {
    id: `berwaldhallen-${ev.EventGroupId}-${ev.EventId}`,
    title: ev.Name,
    description: ev.Description ?? '',
    date,
    time,
    start_time,
    end_time,
    venue: 'Berwaldhallen',
    area: 'Stockholm',
    address: 'Dag Hammarskjölds väg 3, 115 25 Stockholm',
    categories: [category],
    url: ev.PurchaseUrl,
    image_url: null,
    price_info: priceInfo,
    promoter: null,
    organizer: null,
    accessibility: null,
    age_restriction: null,
    tags: [],
    raw_data: ev as unknown as Record<string, unknown>,
  };
}

function inferCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('jazz') || text.includes('musik') || text.includes('konsert') || text.includes('orkester')) return 'music';
  if (text.includes('barn') || text.includes('familj')) return 'family';
  if (text.includes('samtal') || text.includes('föreläsning')) return 'education';
  return 'culture';
}
