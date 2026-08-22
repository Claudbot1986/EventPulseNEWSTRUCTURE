import 'dotenv/config';
import { addPendingRender } from '../02-Ingestion/tools/pendingRenderQueue';

addPendingRender({
  url: 'https://www.medborgarhuset.se/events',
  sourceName: 'medborgarhuset-2',
  reason: 'T0047: SPA / events page rendered via ScrapingBee, adapter selectors not yet tuned for rendered DOM',
  signal: 'routing_decision',
  confidence: 0.85,
  attemptedPaths: ['D-AI-adapter'],
});

addPendingRender({
  url: 'https://www.svenskakyrkan.se/stockholmsdomkyrkoforsamling',
  sourceName: 'storkyrkan-2',
  reason: 'T0047: SPA / svenskakyrkan.se Content Studio — adapter selectors not yet tuned for rendered DOM',
  signal: 'routing_decision',
  confidence: 0.85,
  attemptedPaths: ['D-AI-adapter'],
});

console.log('Added both sources to render queue.');
