# Gates: ingestion + discovery six-fixes (2026-10-21)

OWNS: scripts/ingestion-cron.ts, scripts/verify-fixes.mjs, 09-ScrapingSupervisor/runDaily.ts, 02-Ingestion/A-directAPI-networkGate/runA.ts, 02-Ingestion/C-htmlGate/run-dynamic-pool.ts, 02-Ingestion/tools/runRecorder.ts, 05-Supabase/migrations/20261021-*, 07-Discovery/src/sourceTesting/realToolRunner.ts

Scope: bevis för var och en av de sex fixarna från planen "Fixa ingestion + discovery: sex bevisade fel" (2026-10-21). Verifieras mot riktiga filer, riktig DB och riktiga subprocesser — inga syntetiska räknare.

- [x] G1: eventsExtracted parsas per-steg med null/icke-null-distinktion (plan steg 1A)
  CHECK: node scripts/verify-fixes.mjs g1
  EXPECT: /g1: livespot=\d+ direct-jsonld=\d+ A-directAPI=null pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a2952db924451271cffc9fa0c7892d6b99587f8f9f574e48f30f17bb5fd02935; exit=0; EXPECT=matched; output-sha256=d5ef64227513b5b2effd03a898307bbb663e088c9e0e6fe950b43e18788f5693; output-bytes=57; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G2: green-filen else-gren skriver ok:false + failedSteps + bevarar lastGreenAt (plan steg 1B)
  CHECK: node scripts/verify-fixes.mjs g2
  EXPECT: /g2: red-write preserves lastGreenAt failedSteps=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c0b3a5184cd41890544238b7f0735aa971e93c896fe87e1d1f65cbc497c9c7a6; exit=0; EXPECT=matched; output-sha256=7ddcf97bd6901d0052e6413bc0aa4cf1229fc438e0f47fd2c7669e8d004143d4; output-bytes=55; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G3: totalEventsPersisted räknas ur workerns stdout, inte hårdkodat 0 (plan steg 1C)
  CHECK: node scripts/verify-fixes.mjs g3
  EXPECT: /g3: countWorkerCompletions\+runRecorder totalEventsPersisted decl="number \| null" pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=bae8d47a291bfc85ea0ed3f5855c9a2ec0f988133f1486ecc3cee598e8b3bcc7; exit=0; EXPECT=matched; output-sha256=a0f0c167f6dbb3c1ca0ad9311455776639189464d9981755dac7c04523f71f09; output-bytes=86; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G4: C-htmlGate avslutar rent exit=0 på tom postB-preC-kö + cross-queue dedup borta (plan steg 2)
  CHECK: node scripts/verify-fixes.mjs g4
  EXPECT: /g4: steady-state exit\(0\) \+ cross-queue dedup borta pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b6dec020af6842d0ac1b7855eb8a68fdb7465888126d878ffb9817de010129df; exit=0; EXPECT=matched; output-sha256=336e99444fda572ac1dfc0ff05b79bed3483f96e1a0378c27abb62b45260801d; output-bytes=56; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G5: pattern-promoter + manual-review-triage borta ur cron-kedjan (plan steg 4)
  CHECK: node scripts/verify-fixes.mjs g5
  EXPECT: /g5: pattern-promoter \+ manual-review-triage ur schemat pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2053b08f8f80710ba90080a530b3d5c6935c9d1269a916608b14039e7dc60d8e; exit=0; EXPECT=matched; output-sha256=5068b10ba7b235217cc6630247b977431fa0a92620864729de2c08f3cb887609; output-bytes=60; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G6: discovery-loopen stängd (kandidater claimas, sandboxas, kan promote:as) (plan steg 3)
  CHECK: node scripts/verify-fixes.mjs g6
  EXPECT: /g6: migrationer \+ P3D-steg pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=66cab4327915b756654d466049b60f07da9fa1305c3f0c3a7722c19470ac3c7d; exit=0; EXPECT=matched; output-sha256=02d20e1406675f28deb0620fd2abd06f9fae183605cb9314b9b779fd08e9858f; output-bytes=32; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Handoff: discovery → ingestion (2026-10-23)

Scope: sex fel som höll kvar promoteade källor ute ur ingestion trots att P3D skrev
dem till sources/*.jsonl. Bevis för var och ett, plus två livedagar på riktiga
körningar. city_added: source_candidates + source_candidate_test_queue (0003).

- [x] H1: geoExpansion filtrerar på lat/lng, inte på venues.city
  CHECK: node scripts/verify-fixes.mjs h1
  EXPECT: /h1: geo-bbox filter present venues.city not trusted pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=803cdebbe3da0ad9289508773d280bb7245ad684cc25e3005e7ede0cd6b88795; exit=0; EXPECT=matched; output-sha256=46a74ee77875ff362818c76d45960cf4dffe5a0013c50f17862c93870898f02e; output-bytes=57; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] H2: city finns som kolumn och bärs hela vägen queue → CLI → promote
  CHECK: node scripts/verify-fixes.mjs h2
  EXPECT: /h2: city column\+queue\+cli pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ac97a97d1e48309df53a011c965188844258fc2a63615db6281bfe51c48a89e6; exit=0; EXPECT=matched; output-sha256=debe9e4596877b070b2db329cd7b32b068a139804701fc35d186619052e92145; output-bytes=31; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] H3: slug-kollision i promote dödar inte hela batchen
  CHECK: node scripts/verify-fixes.mjs h3
  EXPECT: /h3: collision non-fatal pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9143ee591ec4f327a30525ef46a8e11216836e856b7f88f1f9a1028346c2a50a; exit=0; EXPECT=matched; output-sha256=9e2008b922e9d4db2affdaa1c1e9e70670d1c401e90ce6ce6700a26464c315df; output-bytes=29; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] H4: stale processing-rader reclaimas ur P3D-kön (och inga sådana ligger kvar)
  CHECK: node scripts/verify-fixes.mjs h4
  EXPECT: /h4: locked_at reclaim present stuck=0 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f981167864adad31b7e3fcdfae9b54e156764dc8e7aa98c9b580f7a895acb0dc; exit=0; EXPECT=matched; output-sha256=37d776e9649d277c5cbfcfe296be0561eb2b6aa4e77d75292c8c87c68e7a2ddd; output-bytes=43; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] H5: en promotead källa passerar isInScope() och är nåbar för A-gatet
  CHECK: node scripts/verify-fixes.mjs h5
  EXPECT: /h5: promoted sources in scope=\d+ queued=\d+ processed=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c877030d5195210e6743e5a5d518dcd63c7261ef931eb641a193266b94b738c3; exit=0; EXPECT=matched; output-sha256=22f7a5735e3955232da9a00f97d211542bd6710c881ca82e7c3f2004162a3df2; output-bytes=58; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] H6: riktig A-körning har behandlat en promotead källa och persisterat events
  CHECK: node scripts/verify-fixes.mjs h6
  EXPECT: /h6: promoted source ran in A-gate events>0 total=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=96f235aecfdb2369f43e967df1b9e89d87fbf7e417620c28f24639c12f5644ea; exit=0; EXPECT=matched; output-sha256=e5393101830357d58b428ed9df85383cc0d9ac65ef3368bab4310f293a5333ae; output-bytes=56; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# End-to-end: hela kedjan ger events (2026-10-23, körning 32263)

Scope: kör ingestion + discovery på riktig data tills kedjan producerar events.
Hittade under körningen: B-gates hänger i evigheten NÄR den lyckas köa events
(lazy-import av 03-Queue/queue.js öppnar 4 Redis-sockets som aldrig stängs).

- [ ] E1: stängningsfunktion finns och runB stänger köerna före process.exit
  CHECK: node scripts/verify-fixes.mjs e1
  EXPECT: /e1: closeAllQueues exporterad\+ runB anropar den pass/

- [ ] E2: ingen gate hänger — varje steg får step-end inom 20 min
  CHECK: node scripts/verify-fixes.mjs e2
  EXPECT: /e2: steg utan step-end=\d+ hängda=\d+ pass/

- [ ] E3: kedjan producerar events — totalEventsPersisted > 0
  CHECK: node scripts/verify-fixes.mjs e3
  EXPECT: /e3: persisted=\d+ sources_success=\d+ pass/

- [ ] E4: discovery→ingestion går igenom på EN körning (ny källa → A-gate → events)
  CHECK: node scripts/verify-fixes.mjs e4
  EXPECT: /e4: promote efter A-körning=\d+ ordning=först pass/

- [ ] E5: ingen källa försvinner tyst — varje död källa är begravd med orsak eller i kö
  CHECK: node scripts/verify-fixes.mjs e5
  EXPECT: /e5: graveyard=\d+ utan_orsak=0 pass/

- [ ] E6: ingen oanvändbar källa ligger kvar i sources/ — varje fil är antingen in-scope eller begravd
  CHECK: node scripts/verify-fixes.mjs e6
  EXPECT: /e6: out_of_scope=0 pass \(\d+ in-scope, \d+ begravda out-of-scope\)/

- [ ] E7: P3D claimar bara kandidater som kan nå databasen (city = 'Stockholm')
  CHECK: node scripts/verify-fixes.mjs e7
  EXPECT: /e7: claim filterar city='Stockholm' pass \(\d+ pending uteslutas\)/

- [ ] E8: cross-source dedup skriver inte identitetskolumner på en annan källas rad
  CHECK: node scripts/verify-fixes.mjs e8
  EXPECT: /e8: cross-source identitet bevarad pass \(0 brott av \d+ uppspelada/

- [ ] E9: drainQueue --status avslutar — ingen läckt Redis-socket
  CHECK: node scripts/verify-fixes.mjs e9
  EXPECT: /e9: --status avslutar rent pass \(exit=0, inga läckta sockets\)/

- [x] E10: källor C lyckas extrahera ifrån står inte som fail i sources_status
  CHECK: node scripts/verify-fixes.mjs e10
  EXPECT: /e10: C-status är konsekvent pass \(\d+ spårade källor, 0 fel/
