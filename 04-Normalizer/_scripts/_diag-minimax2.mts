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
- venue_name: Debaser`;

async function call(label: string, body: any) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t1 = Date.now();
  const data = await res.json();
  const usage = data.usage || {};
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  console.log(`${label.padEnd(45)} | status=${res.status} | ${t1-t0}ms | total=${usage.total_tokens} | completion=${completionTokens} | reasoning=${reasoningTokens} | finish=${data.choices?.[0]?.finish_reason}`);
}

console.log('Key: ', apiKey?.slice(0, 8) + '...');

// Multiple repetitions to test stability
for (let i = 0; i < 3; i++) {
  await call(`A${i+1}: defaults (max_tokens=800, temp=0.7)`, {
    model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: 800, temperature: 0.7,
  });
}

console.log('---');
for (let i = 0; i < 3; i++) {
  await call(`C${i+1}: thinking.type=disabled (max_tokens=800)`, {
    model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: 800, temperature: 0.7, thinking: { type: 'disabled' },
  });
}

console.log('---');
for (let i = 0; i < 3; i++) {
  await call(`G${i+1}: thinking=disabled, max_tokens=400, temp=0.7`, {
    model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: 400, temperature: 0.7, thinking: { type: 'disabled' },
  });
}
