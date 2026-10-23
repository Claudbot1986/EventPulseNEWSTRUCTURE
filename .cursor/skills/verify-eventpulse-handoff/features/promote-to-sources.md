# Promote till `sources/*.jsonl`

## Sub-features

- **`promoteSourceCandidate(root, candidate, promotion)`** (`sandbox.ts:105-157`)
  — skriver `sources/<sourceId>.jsonl` med `verifiedAt` satt (till skillnad
  från sandbox-versionen, som lämnar den `undefined`).
- **Två slug-strategier** — första promote:en av en domän får den snygga
  domän-slugen (`wwwmodernamuseetse`); varje följande URL på samma domän får
  `candidate-<id8>-<slug>`. Utan fallbacken kunde bara EN URL per domän
  någonsin promote:as.
- **Kollision är per kandidat** — överlevande kollision loggar
  `[promote] slug collision for <id> — skipping, source not written` och
  returnerar `null`. Före 2026-10-21 kastade det och dödade hela batchen.
- **`hasCanonicalSourceUrl(root, url, candidateId?)`** — dubblettkontroll.
  Hoppar över sandbox-rader och över kandidatens **egen** tidigare post
  (`metadata.sourceCandidateId === candidateId`).
- **`appendDiscoveryUiQueueEntry`** — en rad per lyckad promote i
  `runtime/discovery-ui-queue.jsonl` med
  `status: 'promoted_to_sources'`.

## How to get to it (user POV)

Du kör P3D och ser `decision: 'promote'` i loggen. Du vill veta att det blev
en fil, att filen ligger i `sources/` (och inte i någon sandbox), och att den
inte skrevs över någon annan sajt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
DBQ=".cursor/skills/verify-eventpulse-handoff/scripts/dbq.mjs"

# 1. Senaste promote-besluten
node "$DBQ" "SELECT d.promoted_source_id, sc.url, d.created_at
               FROM source_candidate_test_decisions d
               JOIN source_candidates sc ON sc.id = d.source_candidate_id
              WHERE d.decision='promote' ORDER BY d.created_at DESC LIMIT 10"

# 2. Finns filerna på disk? (saknas en = promote skrev inte)
for id in $(node "$DBQ" "SELECT DISTINCT d.promoted_source_id
                            FROM source_candidate_test_decisions d
                           WHERE d.decision='promote' AND d.promoted_source_id IS NOT NULL
                           ORDER BY d.created_at DESC LIMIT 10" | tail -n +2); do
  [ -f "sources/$id.jsonl" ] && echo "OK     $id" || echo "SAKNAS $id"
done

# 3. Vad står i filen?
jq -c '{id, url, city, preferredPath, verifiedAt, candidateId: .metadata.sourceCandidateId}' \
  sources/<id>.jsonl

# 4. UI-kön
tail -5 runtime/discovery-ui-queue.jsonl | jq -c '{sourceId, status, city, promotedAt}'
```

## Gotchas

**Promote skriver INTE över en annan källas fil.** `sameCanonicalUrl()`
(`sandbox.ts:99-103`) returnerar `true` bara om filen saknas eller har samma
kanoniska URL. Annars är det kollision → varning → `null`. Verifiera att du
inte tittar på en fil som en *tidigare* promote skrev över en annan URL —
kontrollera `url` i filen mot `sc.url` i DB.

**Sandbox-filer har `metadata.sandbox: true` och `verifiedAt: undefined`.**
Promoteade har `sandbox: false` och `verifiedAt` satt. `hasCanonicalSourceUrl`
hoppar över sandbox-rader — en kandidat som testats men inte promote:ats
lämnar ingen spår i `sources/`.

**UI-kön har färre rader än antalet promote-beslut.** 16 promote-beslut mot
14 rader i `runtime/discovery-ui-queue.jsonl` (2026-10-23) — två promotes
hände innan UI-kön fanns. Det är inte dataförlust i filerna, bara i loggen.

**`promote blocked: slug collision` är rättat beteende, inte ett fel.**
`runner.ts:80-81` vänder beslutet till `manual_review` så att inget ligger
kvar som `promote` utan att något skrevs. 3 sådana beslut existerar. Kedjan
fortsätter med nästa kandidat.

**Två promote:ade filer kan ha samma URL om domänen slug:ar olika.** Efter
fallbacken bär den andra filen `candidate-<id8>-` som prefix. Grepa inte
`ls sources/ | grep moderna` som bevis — kolla `metadata.sourceCandidateId`.

**`sourceIdForCandidate` använder `candidate.id.slice(0, 8)`.** UUID:er som
delar de första 8 tecknen kolliderar. Sällsynt, men möjligt — samma felmeddelande
uppstår då.