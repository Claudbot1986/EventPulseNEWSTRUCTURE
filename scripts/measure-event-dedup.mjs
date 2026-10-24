#!/usr/bin/env node
/**
 * Mäter dedup-regeln i 02-Ingestion/F-eventExtraction/eventDedup.ts mot
 * den RIKTIGA korpusen (03-Queue/03-extractedevents/).
 *
 * Syftet: bevisa att regeln tar bort de dubbletter som ska bort (url-lösa
 * systrar till en url-bärande rad) och INTE tar bort de företrädanden som
 * bara råkar dela titel+datum+tid (klockslaget ligger i url:en).
 *
 * Kör:  node scripts/measure-event-dedup.mjs
 */
import fs from 'fs';
import path from 'path';

const CORPUS = path.resolve(process.cwd(), '03-Queue/03-extractedevents');

const title = (r) =>
  typeof r.title === 'string' ? r.title : (r.title?.rendered ?? JSON.stringify(r.title ?? ''));
const hasUrl = (r) => typeof r.url === 'string' && r.url.trim().length > 0;
const urlOf = (r) => (r.url || '').trim();
const hasDate = (r) => typeof r.date === 'string' && r.date.length > 0;

let rowsTotal = 0;
let rowsExtractorForm = 0;
let rowsAdapterForm = 0;
let groups = 0;
let dropUrlLess = 0;
let dropSameUrl = 0;
let dropNoUrlAtAll = 0;
let keepDistinctUrl = 0;

const perSourceDropped = new Map();
const perSourceKept = new Map();
const protectedExamples = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.jsonl')) continue;

    const id = entry.name.replace(/\.jsonl$/, '');
    let rows = [];
    try {
      rows = fs
        .readFileSync(full, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      continue;
    }
    if (!rows.length) continue;

    rowsTotal += rows.length;
    const extractorForm = rows.filter(hasDate);
    rowsExtractorForm += extractorForm.length;
    rowsAdapterForm += rows.length - extractorForm.length;

    const groupsByIdentity = new Map();
    for (const row of extractorForm) {
      const key = `${title(row).trim()}|${row.date}|${row.time || ''}`;
      groupsByIdentity.set(key, [...(groupsByIdentity.get(key) || []), row]);
    }

    for (const [key, bucket] of groupsByIdentity) {
      if (bucket.length < 2) continue;
      groups++;

      const withUrl = bucket.filter(hasUrl);
      const withoutUrl = bucket.filter((r) => !hasUrl(r));

      if (withUrl.length === 0) {
        dropNoUrlAtAll += bucket.length - 1;
        perSourceDropped.set(id, (perSourceDropped.get(id) || 0) + (bucket.length - 1));
        continue;
      }

      const seenUrls = new Set();
      let sameUrl = 0;
      for (const row of withUrl) {
        const url = urlOf(row);
        if (seenUrls.has(url)) sameUrl++;
        else seenUrls.add(url);
      }
      dropSameUrl += sameUrl;
      keepDistinctUrl += seenUrls.size;
      if (sameUrl) perSourceDropped.set(id, (perSourceDropped.get(id) || 0) + sameUrl);

      if (withoutUrl.length > 0) {
        dropUrlLess += withoutUrl.length;
        perSourceDropped.set(id, (perSourceDropped.get(id) || 0) + withoutUrl.length);
      } else if (seenUrls.size > 1) {
        perSourceKept.set(id, (perSourceKept.get(id) || 0) + (seenUrls.size - 1));
        if (protectedExamples.length < 8) {
          protectedExamples.push({ id, key, urls: [...seenUrls].slice(0, 2) });
        }
      }
    }
  }
}

if (!fs.existsSync(CORPUS)) {
  console.error(`Korpusen saknas: ${CORPUS}`);
  process.exit(1);
}

walk(CORPUS);

const top = (map) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ');

console.log(`Korpus: ${CORPUS}`);
console.log(`Rader totalt: ${rowsTotal} (extractor-form ${rowsExtractorForm}, adapter-form ${rowsAdapterForm})`);
console.log(`Grupper med identisk titel+datum+tid: ${groups}`);
console.log('');
console.log('BORT-tagna (är dubbletter):');
console.log(`  url-lös syster när en url-bärande finns: ${dropUrlLess}`);
console.log(`  exakt dubblett (samma url två gånger):    ${dropSameUrl}`);
console.log(`  grupp utan någon url (behålls en):         ${dropNoUrlAtAll}`);
console.log('');
console.log('BEHÅLLNA (skilda företrädanden — får INTE tas bort):');
console.log(`  distinkta url inom samma identitet: ${keepDistinctUrl}`);
console.log(`  per källa: ${top(perSourceKept)}`);
console.log('');
console.log('Per källa borttagna: ' + top(perSourceDropped));
console.log('');
for (const ex of protectedExamples) {
  console.log(`  [skyddad ${ex.id}] ${ex.key} :: ${JSON.stringify(ex.urls).slice(0, 120)}`);
}
