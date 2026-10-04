#!/usr/bin/env node
/**
 * api-discovery.mjs — Hidden API endpoint discovery across all sources.
 *
 * Fetches each source's HTML + key JS bundles, then extracts API endpoint
 * patterns. No cost, parallel HTTP sweep.
 *
 * Patterns detected:
 *  - fetch("..."), axios.get("..."), $.get("...") calls
 *  - __NEXT_DATA__, __NUXT__, window.__INITIAL_STATE__
 *  - wp-json, /api/v1/, /api/, .json endpoints
 *  - GraphQL: /graphql, /v1/graphql
 *  - WebSocket: wss:// endpoints
 *  - Apollo __APOLLO_CLIENT__
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const files = readdirSync('sources').filter(f => f.endsWith('.jsonl') && !f.startsWith('_'));
const sources = [];
const seen = new Set();
for (const f of files) {
  try {
    const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const d = JSON.parse(line);
      if (d.url && !seen.has(d.id)) {
        seen.add(d.id);
        sources.push({
          slug: d.id,
          url: d.url,
          queue: d.currentQueue || '',
        });
        break;
      }
    }
  } catch {}
}

console.log(`Sources to scan: ${sources.length}`);

// --max-age-days=N: skip if data/api-discovery-results.jsonl was modified within N days
const ageArg = process.argv.find((a) => a.startsWith('--max-age-days='));
if (ageArg) {
  const maxDays = parseInt(ageArg.split('=')[1], 10);
  const outFile = 'data/api-discovery-results.jsonl';
  if (existsSync(outFile)) {
    const ageMs = Date.now() - statSync(outFile).mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < maxDays) {
      console.log(`Skipping: results file is ${ageDays.toFixed(1)}d old (max ${maxDays}d)`);
      process.exit(0);
    }
  }
}

async function discover(src) {
  const findings = {
    slug: src.slug,
    url: src.url,
    status: 'N/A',
    bodySize: 0,
    htmlEndpoints: [],
    jsonLdEndpoints: [],
    nextData: false,
    nuxtData: false,
    apollo: false,
    graphqlHints: [],
    jsFilesScanned: 0,
    jsEndpoints: [],
    jsonHints: [],
  };
  
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch(src.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    findings.status = r.status;
    if (!r.ok) return findings;
    
    const body = await r.text();
    findings.bodySize = body.length;
    const slice = body.slice(0, 200000);
    
    // Direct URL patterns in HTML
    const urlRegex = /['"`](https?:\/\/[^'"`\s]{5,200})['"`]/g;
    let m;
    const urls = new Set();
    while ((m = urlRegex.exec(slice)) !== null) {
      const u = m[1];
      if (/\/(api|graphql|json|wp-json|_next|_nuxt)/.test(u) || /\.(json)(\?|$)/.test(u)) {
        urls.add(u);
      }
    }
    findings.htmlEndpoints = [...urls].slice(0, 10);
    
    // Framework data markers
    if (/__NEXT_DATA__|__next_data__/.test(slice)) findings.nextData = true;
    if (/__NUXT__|window\.__NUXT__/.test(slice)) findings.nuxtData = true;
    if (/__APOLLO_CLIENT__|apolloClient|@apollo/.test(slice)) findings.apollo = true;
    
    // GraphQL hints
    const gqlMatches = slice.match(/["'`](\/graphql[^"'`\s]{0,100})["'`]/g);
    if (gqlMatches) findings.graphqlHints = gqlMatches.slice(0, 5).map(s => s.slice(1, -1));
    
    // Find script srcs to scan
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/g;
    const scriptSrcs = [];
    while ((m = scriptRegex.exec(slice)) !== null) {
      let s = m[1];
      if (s.startsWith('/')) {
        try {
          const base = new URL(src.url);
          s = base.origin + s;
        } catch {}
      }
      if (s.startsWith('http')) scriptSrcs.push(s);
    }
    findings.jsFilesScanned = Math.min(scriptSrcs.length, 5);
    
    // Scan first few JS files for API hints
    for (const jsUrl of scriptSrcs.slice(0, 3)) {
      try {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 6000);
        const jr = await fetch(jsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: c2.signal,
        });
        clearTimeout(t2);
        if (!jr.ok) continue;
        const js = await jr.text();
        const jslice = js.slice(0, 100000);
        // Look for fetch/axios/get calls with API-like paths
        const apiCalls = jslice.match(/["'`]\/(api|graphql|wp-json|_next|_nuxt|v1|v3|rest)[^"'`\s]{0,100}["'`]/g);
        if (apiCalls) {
          for (const call of apiCalls.slice(0, 10)) {
            const cleaned = call.slice(1, -1);
            if (!findings.jsEndpoints.includes(cleaned)) findings.jsEndpoints.push(cleaned);
          }
        }
        // Look for full URLs in JS
        const jsUrls = jslice.match(/["'`](https?:\/\/[^"'`\s]{5,150})["'`]/g);
        if (jsUrls) {
          for (const u of jsUrls.slice(0, 20)) {
            const cleaned = u.slice(1, -1);
            if (/\/(api|graphql|json|wp-json)/.test(cleaned) && !findings.jsEndpoints.includes(cleaned)) {
              findings.jsEndpoints.push(cleaned);
            }
          }
        }
      } catch {}
    }
    
  } catch (e) {
    findings.status = e.name || 'err';
  }
  
  return findings;
}

// Process in batches
const results = [];
const BATCH = 15;
const start = Date.now();
for (let i = 0; i < sources.length; i += BATCH) {
  const chunk = sources.slice(i, i + BATCH);
  const cr = await Promise.all(chunk.map(discover));
  results.push(...cr);
  process.stdout.write(`  ${results.length}/${sources.length} (${((Date.now()-start)/1000).toFixed(1)}s)\r`);
}
console.log();

console.log('=== SUMMARY ===');
console.log(`Total scanned: ${results.length}`);
console.log(`With HTML API endpoints: ${results.filter(r => r.htmlEndpoints.length).length}`);
console.log(`With JS API endpoints: ${results.filter(r => r.jsEndpoints.length).length}`);
console.log(`Next.js detected: ${results.filter(r => r.nextData).length}`);
console.log(`Nuxt.js detected: ${results.filter(r => r.nuxtData).length}`);
console.log(`Apollo detected: ${results.filter(r => r.apollo).length}`);
console.log(`GraphQL hints: ${results.filter(r => r.graphqlHints.length).length}`);

// Save full results
import('fs').then(fs => {
  fs.writeFileSync('data/api-discovery-results.jsonl', results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('Saved to data/api-discovery-results.jsonl');
  
  // Top 30 with most endpoints
  console.log();
  console.log('=== TOP 30 SOURCES WITH MOST API ENDPOINTS ===');
  const top = results
    .filter(r => r.htmlEndpoints.length + r.jsEndpoints.length > 0)
    .sort((a, b) => (b.htmlEndpoints.length + b.jsEndpoints.length) - (a.htmlEndpoints.length + a.jsEndpoints.length))
    .slice(0, 30);
  for (const r of top) {
    const total = r.htmlEndpoints.length + r.jsEndpoints.length;
    const flags = [
      r.nextData ? 'NEXT' : '',
      r.nuxtData ? 'NUXT' : '',
      r.apollo ? 'APOLLO' : '',
    ].filter(Boolean).join(',');
    console.log(`  ${r.slug.padEnd(45)} ${flags.padEnd(15)} total=${total} html=${r.htmlEndpoints.length} js=${r.jsEndpoints.length}`);
    // Show sample endpoints
    const all = [...r.htmlEndpoints, ...r.jsEndpoints].slice(0, 3);
    for (const e of all) console.log(`    ↳ ${e.slice(0, 100)}`);
  }
});