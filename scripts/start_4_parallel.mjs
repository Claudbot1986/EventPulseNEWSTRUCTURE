#!/usr/bin/env node
// scripts/start_4_parallel.mjs
// Starta 4 batcher parallellt: rock, electronic, fairs, technology
// med count=20, --reset-state=true
const cats = ['rock', 'electronic', 'fairs', 'technology'];

async function startOne(cat) {
  const r = await fetch('http://localhost:7777/api/bfl/zoom-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 20, resetState: true, categories: [cat] }),
  });
  const j = await r.json();
  return { cat, runId: j.runId, count: j.count };
}

for (const r of await Promise.all(cats.map(startOne))) {
  console.log(`${r.cat}: runId=${r.runId} count=${r.count}`);
}
