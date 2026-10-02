#!/usr/bin/env node
/**
 * Berwaldhallen info-sida backfill (2026-10-02).
 *
 * Vi har redan description via boka.berwaldhallen.se (köpbtn) men den riktiga
 * konsertbeskrivningen finns på berwaldhallen.se/konsert/{slug}/. Denna script
 * mappar varje event till rätt info-sida och uppdaterar description därifrån.
 *
 * URL-pattern:
 *   boka.berwaldhallen.se/sv/buyingflow/tickets/{eventId}/{ticketId}/  (köpbtn)
 *   berwaldhallen.se/konsert/{slug}/                                   (info-sida)
 *
 * Slug genereras från title_sv (slugifiering av svenska titlar).
 *
 * Run: npx tsx scripts/backfill-berwaldhallen-info-pages.mjs
 */

import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const SOURCE = 'berwaldhallen';
const PAGE = 1000;

function slugify(title) {
  return (title || '')
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e').replace(/è/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchHtml(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse/1.0 (+https://eventpulse.app)' }
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function extractDescription(html) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);

  // Strategy 1: JSON-LD description
  let desc = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() || '';
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      const m = content.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && m[1].length >= 50) {
        desc = m[1].replace(/\\"/g, '"').replace(/<em>|<\/em>|<br>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    if (!desc && data) {
      const find = (obj, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== 'object') return null;
        if (typeof obj.description === 'string' && obj.description.length >= 50) return obj.description;
        for (const k of Object.keys(obj)) {
          const f = find(obj[k], depth + 1);
          if (f) return f;
        }
        return null;
      };
      desc = find(data);
    }
  });
  if (desc && desc.length >= 50) {
    // Strip HTML-tags
    const $d = cheerio.load(desc);
    desc = $d.text().replace(/\s+/g, ' ').trim();
    return desc.slice(0, 1500);
  }

  // Strategy 2: og:description / meta description
  const og = $('meta[property="og:description"]').attr('content');
  if (og && og.length >= 50) return og.trim();

  return null;
}

async function main() {
  console.log(`[berwaldhallen-info] BEGIN ${new Date().toISOString()}`);

  // Hämta alla events
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, title_sv, ticket_url, description_sv')
      .eq('source', SOURCE)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total events: ${all.length}`);

  // Unika slugs (testa så jag inte slösar på boka-samma events H2)
  const slugToIds = new Map();
  for (const e of all) {
    if (!e.title_sv) continue;
    const slug = slugify(e.title_sv);
    if (!slug) continue;
    if (!slugToIds.has(slug)) slugToIds.set(slug, []);
    slugToIds.get(slug).push(e.id);
  }
  console.log(`Unique slugs: ${slugToIds.size}`);

  let updated = 0, noSlug = 0, notFound = 0, noDesc = 0, errored = 0;
  const log = [];

  for (const [slug, ids] of slugToIds) {
    const url = `https://www.berwaldhallen.se/konsert/${slug}`;
    try {
      const html = await fetchHtml(url);
      if (!html) {
        notFound++;
        log.push({ slug, status: '404' });
        continue;
      }
      const desc = await extractDescription(html);
      if (!desc || desc.length < 50) {
        noDesc++;
        log.push({ slug, status: 'NO_DESC' });
        continue;
      }
      const { error } = await supabase.from('events')
        .update({ description_sv: desc, description_en: desc })
        .in('id', ids);
      if (error) throw error;
      updated += ids.length;
      log.push({ slug, status: 'OK', count: ids.length, len: desc.length });
    } catch (err) {
      errored++;
      log.push({ slug, status: 'ERROR', error: err.message });
    }
  }

  console.log(`\n[berwaldhallen-info] DONE`);
  console.log(`  unique slugs processed: ${slugToIds.size}`);
  console.log(`  events updated: ${updated}`);
  console.log(`  slugs utan titel (skippade): ${noSlug}`);
  console.log(`  404/inte hittade: ${notFound}`);
  console.log(`  ingen description på sidan: ${noDesc}`);
  console.log(`  errored: ${errored}`);

  const failed = log.filter(l => l.status !== 'OK');
  if (failed.length > 0) {
    console.log(`\nFailed (${failed.length}):`);
    for (const f of failed.slice(0, 30)) {
      console.log(`  [${f.status}] ${f.slug}`);
    }
    if (failed.length > 30) console.log(`  ... +${failed.length - 30} more`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });