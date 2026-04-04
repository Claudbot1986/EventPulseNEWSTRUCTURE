/**
 * URL Sanity — First pass in scouting
 *
 * Quick check: can the URL be reached? Does it need normalization?
 * Returns a simple pass/fail with details.
 * Properly tracks redirect chains to find the final destination.
 */

import axios, { AxiosError } from 'axios';
import type { UrlSanityEvidence } from './scoutResult.js';

export interface UrlSanityResult {
  reachable: boolean;
  normalizedUrl?: string;
  redirectCount?: number;
  finalUrl?: string;
  redirectChain?: string[];
  error?: string;
  statusCode?: number;
}

/**
 * Fetch with explicit redirect tracking.
 * Returns the redirect chain and final URL.
 */
async function fetchWithRedirectTracking(
  url: string,
  timeout: number = 15000,
  redirectChain: string[] = []
): Promise<{
  success: boolean;
  redirectChain: string[];
  finalUrl: string;
  statusCode?: number;
  error?: string;
}> {
  // Initialize chain with this URL if empty
  const chain = redirectChain.length === 0 ? [url] : redirectChain;
  let currentUrl = url;
  const maxRedirects = 10;

  try {
    const response = await axios.get(currentUrl, {
      headers: {
        'User-Agent': 'EventPulse/1.0 (scouting)',
        'Accept': 'text/html,*/*',
      },
      timeout,
      maxRedirects: 0, // Don't auto-follow redirects - track manually
      validateStatus: (status) => status < 500,
    });

    // Check for redirect
    const location = response.headers.location;
    if (location && chain.length < maxRedirects) {
      // Resolve relative URLs
      const nextUrl = new URL(location, currentUrl).href;
      // Add to chain and recursively follow
      chain.push(nextUrl);
      return fetchWithRedirectTracking(nextUrl, timeout, chain);
    }

    // No more redirects - return final result
    return {
      success: response.status === 200,
      redirectChain: chain,
      finalUrl: currentUrl,
      statusCode: response.status,
    };
  } catch (err: any) {
    // Handle axios errors
    const axiosError = err as AxiosError;
    
    // Check if it's a redirect error (3xx without Location header)
    if (axiosError.response && axiosError.response.status >= 300 && axiosError.response.status < 400) {
      const location = axiosError.response.headers.location;
      if (location && chain.length < maxRedirects) {
        const nextUrl = new URL(location, currentUrl).href;
        chain.push(nextUrl);
        return fetchWithRedirectTracking(nextUrl, timeout, chain);
      }
    }

    // Connection/timeout error
    return {
      success: false,
      redirectChain: chain,
      finalUrl: currentUrl,
      error: err.message,
      statusCode: axiosError.response?.status,
    };
  }
}

/**
 * Attempt a HEAD/GET request to check URL health.
 * Tracks full redirect chain to find the final destination.
 */
export async function checkUrlSanity(url: string): Promise<UrlSanityResult> {
  // Step 1: normalize URL
  let normalizedUrl: string;
  try {
    if (!url.match(/^https?:\/\//i)) {
      normalizedUrl = `https://${url}`;
    } else {
      normalizedUrl = url;
    }
    // Validate URL is parseable
    new URL(normalizedUrl);
  } catch {
    return {
      reachable: false,
      error: `Malformed URL: ${url}`,
    };
  }

  // Step 2: try HTTPS first, fall back to HTTP
  let result = await fetchWithRedirectTracking(normalizedUrl, 15000);
  
  // If HTTPS fails with connection error, try HTTP
  if (!result.success && result.error?.includes('timeout') || result.error?.includes('ECONNREFUSED')) {
    const httpUrl = normalizedUrl.replace(/^https:/, 'http:');
    result = await fetchWithRedirectTracking(httpUrl, 15000);
  }

  if (!result.success) {
    return {
      reachable: false,
      normalizedUrl,
      redirectCount: Math.max(0, result.redirectChain.length - 1),
      redirectChain: result.redirectChain,
      finalUrl: result.finalUrl,
      error: result.error ?? 'unknown',
      statusCode: result.statusCode,
    };
  }

  return {
    reachable: true,
    normalizedUrl,
    redirectCount: Math.max(0, result.redirectChain.length - 1),
    redirectChain: result.redirectChain,
    finalUrl: result.finalUrl,
    statusCode: result.statusCode,
  };
}

/**
 * Extract a simple source name from URL for human readability.
 */
export function extractSourceName(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, '');
    // Get first meaningful path segment if present
    const parts = u.pathname.split('/').filter(p => p && p.length > 2);
    if (parts.length > 0) {
      return `${host}-${parts[0]}`;
    }
    return host;
  } catch {
    return url.slice(0, 30);
  }
}
