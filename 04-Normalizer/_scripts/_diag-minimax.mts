const apiKey = process.env.MINIMAX_API_KEY;
const baseUrl = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/v1';
const model = process.env.MINIMAX_MODEL ?? 'minimax-M3';

const systemPrompt = `Du är redaktiverande skribent för ett Stockholm-eventmagasin.

REGLER:
1. Skriv BARA från informationen i Profilen.
2. Hitta ALDRIG på fakta.
3. 2-3 meningar på svenska.`;

const userPrompt = `PROFIL:
- event_type: music
- performers: Hooligan Bobs
- genres: rock
- setting: klubb

EVENEMANG:
- titel: Hooligan Bobs på Debaser
- venue_name: Debaser
- city: Stockholm`;

async function call(label: string, body: any) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t1 = Date.now();
  const data = await res.json();
  console.log(`\n═════ ${label} (status=${res.status}, latency=${t1-t0}ms) ═════`);
  console.log('Top keys:', Object.keys(data));
  if (data.choices?.[0]) {
    const c = data.choices[0];
    console.log('choice keys:', Object.keys(c));
    console.log('finish_reason:', c.finish_reason);
    const content = c.message?.content ?? '';
    console.log('content_len:', content.length);
    console.log('content preview:', content.slice(0, 300));
  }
  if (data.usage) console.log('usage:', JSON.stringify(data.usage, null, 2));
  if (data.error) console.log('error:', JSON.stringify(data.error, null, 2));
}

await call('A: defaults (max_tokens=800)', {
  model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0.7,
});

await call('B: enable_thinking=false', {
  model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0.7, enable_thinking: false,
});

await call('C: thinking.type=disabled', {
  model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0.7, thinking: { type: 'disabled' },
});

await call('D: reasoning_effort=low', {
  model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0.7, reasoning_effort: 'low',
});

await call('E: /no_think system suffix', {
  model, messages: [{ role: 'system', content: systemPrompt + '\n\n/no_think' }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0.7,
});

await call('F: temp=0', {
  model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
  max_tokens: 800, temperature: 0,
});
