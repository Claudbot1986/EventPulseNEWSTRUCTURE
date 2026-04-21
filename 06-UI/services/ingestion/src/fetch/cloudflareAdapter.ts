/**
 * Cloudflare Fetch Adapter
 * 
 * Provides a unified fetch interface that can use Cloudflare Workers as proxy
 * for scraping protected endpoints.
 * 
 * Architecture:
 * - If CLOUDFLARE_WORKER_URL is configured: use Worker as proxy
 * - Otherwise: use direct fetch (standard http.request)
 * 
 * Usage:
 *   const { fetchWithCf } = require('./cloudflareAdapter');
 *   const data = await fetchWithCf('https://protected-site.com/api');
 */

import { rawEventsQueue } from '../queue';

const CLOUDFLARE_WORKER_URL = process.env.CLOUDFLARE_WORKER_URL;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

/**
 * Check if Cloudflare Worker proxy is configured
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(CLOUDFLARE_WORKER_URL && CLOUDFLARE_API_TOKEN);
}

/**
 * Fetch data using Cloudflare Worker proxy if available,
 * otherwise fall back to direct fetch
 */
export async function fetchWithCf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  if (isCloudflareConfigured()) {
    console.log(`[fetch] Using Cloudflare proxy for: ${url}`);
    return fetchViaCloudflareWorker(url, options);
  }
  
  console.log(`[fetch] Using direct fetch for: ${url}`);
  return fetch(url, options);
}

/**
 * Fetch via Cloudflare Worker proxy
 */
async function fetchViaCloudflareWorker(
  url: string,
  options: RequestInit
): Promise<Response> {
  const response = await fetch(CLOUDFLARE_WORKER_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({ url, options }),
  });
  
  if (!response.ok) {
    throw new Error(`Cloudflare Worker error: ${response.status} ${response.statusText}`);
  }
  
  return response;
}

/**
 * Simple direct fetch (for when Cloudflare is not needed)
 */
export async function simpleFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, options);
}

export default { fetchWithCf, isCloudflareConfigured, simpleFetch };
