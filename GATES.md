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
