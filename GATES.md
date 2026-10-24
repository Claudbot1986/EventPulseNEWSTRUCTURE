# Gates: ingestion + discovery six-fixes (2026-10-21)

OWNS: scripts/ingestion-cron.ts, scripts/verify-fixes.mjs, 09-ScrapingSupervisor/runDaily.ts, 02-Ingestion/A-directAPI-networkGate/runA.ts, 02-Ingestion/C-htmlGate/run-dynamic-pool.ts, 02-Ingestion/tools/runRecorder.ts, 05-Supabase/migrations/20261021-*, 07-Discovery/src/sourceTesting/realToolRunner.ts, 03-Queue/importToEventPulse.ts, 02-Ingestion/F-eventExtraction/universal-extractor.ts, 04-Normalizer/normalizer.ts, scripts/verify-extractor-object-fields.mjs, scripts/verify-import-pipeline.mjs, scripts/verify-date-ranges.ts, 02-Ingestion/F-eventExtraction/universal-extractor-date-range.test.ts

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

- [x] G7: C-htmlGate:s programmatiska ingång avslutar rent på tom postB-preC-kö
  CHECK: node scripts/verify-fixes.mjs g7
  EXPECT: /g7: programmatisk C-ingång avslutar rent exit=0 på tom postB-preC-kö pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=50e1a51f94e8284c730ca9f7f9484f310e3429f2e1a706eec4acfd05d619f6ea; exit=0; EXPECT=matched; output-sha256=19371a5183bdfa4f5f4ef951e954e70e77352af8f29185562d38b14fb2d295ed; output-bytes=77; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G8: datumvakten behåller ett holdags-event som pågår idag
  CHECK: node scripts/verify-fixes.mjs g8
  EXPECT: /g8: datumvakten behåller holdags-event dated idag och kastar bort gårdagens pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=160922fb4111a8347b2baeefe1e9c4db7f1034cdde4d5e386e92be3ed354d9bf; exit=0; EXPECT=matched; output-sha256=76189cd96e4ccaab26a3788ea66a81d2c9f8efbaf72f0c589591f2b9550f71a2; output-bytes=83; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] G9: requeue-sources kan köa om en specifik källa i C-gaten (isolerat, idempotent, vägrar okända källor)
  CHECK: node scripts/verify-fixes.mjs g9
  EXPECT: /g9: requeue-sources köar en specifik källa i postB-preC, är idempotent och vägrar okända källor/
  EVIDENCE: automatic-evidence=v1; definition-sha256=1a6ac57fe33f6b5b3f5bee396ced7a3251b4900bb93008683349b254609da00d; exit=0; EXPECT=matched; output-sha256=fe2b71c9426559f34f9fd820290b748205e3d11ced5408be09bfb0fbded9d8bf; output-bytes=102; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

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

- [x] H4: stale processing-rader får inte ligga kvar, och reclaimen finns i den LEVENDE funktionen
  CHECK: node scripts/verify-fixes.mjs h4
  EXPECT: /h4: reclaim i LEVENDE funktion \+ 0 stuck pass \(stranded=\d+, city-gated reclaim=\w+\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9d1db092a19b63d7d7f0450c0ce28ddfee3e9c869128cf79a121d570ea6d19dc; exit=0; EXPECT=matched; output-sha256=87629b7e313c33f3f7eba931858dee63b369b1c1bda184170c5ae891e6fef320; output-bytes=82; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

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

- [x] E1: stängningsfunktion finns och runB stänger köerna före process.exit
  CHECK: node scripts/verify-fixes.mjs e1
  EXPECT: /e1: closeAllQueues exporterad \+ runB anropar den pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a49c058e7994515d2d5e68f189fba319d57e9f87f45ece9c0317b7bc7e39aafd; exit=0; EXPECT=matched; output-sha256=0678fc5d97f2f37fcd7d057b0e8a8c27fde0037373675f0f69ffafb0d5915609; output-bytes=54; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E2: ingen gate hänger — varje steg får step-end inom 20 min
  CHECK: node scripts/verify-fixes.mjs e2
  EXPECT: /e2: steg utan step-end=\d+ hängda=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=8f2d682ee7250ca0bc9b9e273c8125d508a5b964e7df45b24d2c070664c3ec80; exit=0; EXPECT=matched; output-sha256=0e409d6bcbd8375c14c0f03748e2369a830501559ee91d9960f0085989e68e0a; output-bytes=71; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E3: kedjan producerar events — totalEventsPersisted > 0
  CHECK: node scripts/verify-fixes.mjs e3
  EXPECT: /e3: persisted=\d+ sources_success=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a266f2527d09c8c67c214b2c5bf208330fefdde21f357d32d9f1e48b0aaa6beb; exit=0; EXPECT=matched; output-sha256=8d1e7800d407b2f92e016c13f8c923b371a895e0a011929e6130a6bdf0f39e55; output-bytes=70; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E4: discovery→ingestion går igenom på EN körning (ny källa → A-gate → events)
  CHECK: node scripts/verify-fixes.mjs e4
  EXPECT: /e4: promote efter A-körning=\d+ ordning=först pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=931725875e90d8ea9dfb2c3ddb5a6a73a46168a2e7de0e398e2d336d05642872; exit=0; EXPECT=matched; output-sha256=fe8e2285005fcb483c7a8f97c11e2533246d4220e900d7de452200359fdb073f; output-bytes=78; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E5: ingen källa försvinner tyst — varje död källa är begravd med orsak eller i kö
  CHECK: node scripts/verify-fixes.mjs e5
  EXPECT: /e5: graveyard=\d+ utan_orsak=0 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c5037fcb48bede69e88240bedfff8d76c61562452af0e16969a6e765fbbb2caf; exit=0; EXPECT=matched; output-sha256=f50671c4e592f68ba210197a0def2b2e015007794c521a2a34c38772263ef5e7; output-bytes=94; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E6: ingen oanvändbar källa ligger kvar i sources/ — varje fil är antingen in-scope eller begravd
  CHECK: node scripts/verify-fixes.mjs e6
  EXPECT: /e6: out_of_scope=0 pass \(\d+ in-scope, \d+ begravda out-of-scope\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f7f6ba43537e5ccec44b3a8d6053dc84eb81fdd0e2ce6d6a2e7f26c16a316090; exit=0; EXPECT=matched; output-sha256=ce9918cb0a1303ecc7017f80723a93b2875a07fca2050c55ef27879a12d921ac; output-bytes=65; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E7: P3D claimar bara kandidater som kan nå databasen (city = 'Stockholm')
  CHECK: node scripts/verify-fixes.mjs e7
  EXPECT: /e7: claim filterar city='Stockholm' pass \(\d+ pending uteslutas\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=5503d742ba6640fb8dbecdf98794b006b93d370f45a3720c99b93e6b5e20ea52; exit=0; EXPECT=matched; output-sha256=84d029ff8b5e475885d0f7e0d6e0d1bae741c6591cee508a9036c93414d24118; output-bytes=65; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E8: cross-source dedup skriver inte identitetskolumner på en annan källas rad
  CHECK: node scripts/verify-fixes.mjs e8
  EXPECT: /e8: cross-source identitet bevarad pass \(0 brott av \d+ uppspelade/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9494ce278eabd83308f3d3b18df5f9ab14e1672ad430da8e050fd5a3053a10e9; exit=0; EXPECT=matched; output-sha256=86b99dd75060500262b5eb0e4e4779a84da64cd9e7a7c8f107fac7617a5ed691; output-bytes=104; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E9: drainQueue --status avslutar — ingen läckt Redis-socket
  CHECK: node scripts/verify-fixes.mjs e9
  EXPECT: /e9: --status avslutar rent pass \(exit=0, inga läckta sockets\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=36110cc8bb3fcc3cad0b1bab94d26969652d0f7870c32998f210430f9b70911e; exit=0; EXPECT=matched; output-sha256=439425b847707a56cd267f1fef1452db26d026ac9d5a35eaf371a64aafee0861; output-bytes=63; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E10: källor C lyckas extrahera ifrån står inte som fail i sources_status
  CHECK: node scripts/verify-fixes.mjs e10
  EXPECT: /e10: C-status är konsekvent pass \(\d+ spårade källor, 0 fel/
  EVIDENCE: automatic-evidence=v1; definition-sha256=755f95a7f6f77005cdc3fc36b325a8fb754738ab2dfe7e2cc2bf4931ece5815d; exit=0; EXPECT=matched; output-sha256=801a11338b8a6e9fc7841a35fd37c4fa8b149f7935a0bf4bff85fd18ffa70046; output-bytes=101; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] E11: import-to-eventpulse körs i kedjan och före worker-drain
  CHECK: node scripts/verify-fixes.mjs e11
  EXPECT: /e11: import→drain ordnad pass \(import-to-eventpulse #\d+ → worker-drain #\d+, \d+ events till bullmq, exit=0\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=5e8e520729c7a8fc5f17061e644bedda225ce5d9cdf03058ff4f5285ced9d3b8; exit=0; EXPECT=matched; output-sha256=7ad6091f99eac07b4dc5f37a0207f38e5ee74b8abfbf8ef32fd13f11c35af802; output-bytes=113; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Avslutningssäkerhet: hänger events i luften när kedjan stoppas (2026-10-23)

Scope: tre fel som gjorde att "funna" events aldrig nådde databasen.
1. startWorker.ts hade ingen SIGTERM-handler — in-flight jobb fastnade i
   `active` med utgången lås och persisterades ALDRIG.
2. `drainQueue --status` var inte read-only — utan process.exit(0) föll den
   rakt in i en riktig dränering av produktionskön.
3. processRawEvent kastade efter att eventet redan skrivits till Supabase —
   jobbet markerades failed, vilket säger "inget persisterades".

Negativ kontroll (S1): samma kontroll körs mot en kopia av startWorker.ts
UTAN SIGTERM-handler. Den MÅSTE lämna orphaner — annars mäter gaten
ingenting. Kopian ligger i 03-Queue/ så att dess relativa importer
('./queue', '../04-Normalizer/normalizer') fortfarande löser.

- [x] S1: SIGTERM lämnar inga orphaner — och gaten kan faila
  CHECK: node scripts/verify-shutdown-safety.mjs --only=sigterm
  EXPECT: /fast kod: 0 orphaner efter SIGTERM[\s\S]*negativ kontroll: \d+ orphaner utan SIGTERM-handler/
  EVIDENCE: automatic-evidence=v1; definition-sha256=5dea0932176aefe88cf8794037b20aacc7a811174cbe64754c47885833fc1106; exit=0; EXPECT=matched; output-sha256=2b1c8f07624378f6c454ba5b91cc01c34982c3a995e7232d0b8d9c7b6384d5c9; output-bytes=360; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] S2: --status är read-only — den dränerar inte produktionskön
  CHECK: node scripts/verify-shutdown-safety.mjs --only=status
  EXPECT: /--status avslutade rent \(exit 0\) utan att röra kön/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ba1b7e08a810ab6e69d86cbb39a704fa109d35d76b1dc29cb12417da73e99008; exit=0; EXPECT=matched; output-sha256=e888e43c7e50dc31bc6d221ea6d77e8b3a184950d16c5e5f1b87d094c0d26ddc; output-bytes=178; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] S3: riktig drain persisterar events — completed = failed = 0
  CHECK: node scripts/verify-shutdown-safety.mjs --only=drain
  EXPECT: /drain: \d+ jobb completed, 0 failed, \d+ events persisterade i Supabase/
  EVIDENCE: automatic-evidence=v1; definition-sha256=d5d774537dec8ced08cd42dabefdb17a3d9d74ca717479ec9747ff259ebebcdc; exit=0; EXPECT=matched; output-sha256=3edbd38587a007bdc18d7f86955254bfe7b9dba03c5e1e5e3dca76a9a2de39d7; output-bytes=187; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Confetti-adapter: källa → API → events i Supabase (2026-10-23)

Scope: Confetti-CMS är verifierat på två orelaterade domäner (kmh.confetti.events
och founders-alliance.confetti.events), så mönstret är General enligt
Generalization Protection Rule och fick en source-adapter i stället för en
C-lager-Ändring. Kedjan som bevisas här går genom fyra lager som tidigare varit
åtskilda: Confetti-CMS-API → adapter → 03-Queue/03-extractedevents/ → BullMQ
`raw_events` → worker → 04-Normalizer → Supabase `events`.

Varje gate har en negativ kontroll (se T5 — gaterna körs mot en medvetet trasig
kopia och MÅSTE falla).

- [x] T1: adaptern är registrerad och hittas både explicit och via värd
  CHECK: node scripts/verify-confetti-chain.mjs t1
  EXPECT: /t1: adapter 'confetti' registrerad, värdmatchning: explicit\+auto pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ea60cd0c56501cfc559e77691d654922abc452762de5e76ebd652db7d79df155; exit=0; EXPECT=matched; output-sha256=27a6cc1af1d0c878c1fd13ae14e97c1633fb00760c72eeb645d48800153acdba; output-bytes=144; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] T2: A-gatet körde API-spåret (inte HTML) och fick events
  CHECK: node scripts/verify-confetti-chain.mjs t2
  EXPECT: /t2: A-gatet körde API-adaptern för 2 Confetti-källor/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a7eb9dfd10d5cbc050afb5ed73d971cc11a58b5b7532a8fcdc8659042dcb7ebc; exit=0; EXPECT=matched; output-sha256=45b37c59d39c7e43026fe90424a1a1d24d9694594926665729db47fb1472af3c; output-bytes=179; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] T3: extractedevents matchar Confetti-APIt rad för rad — inga upphittade event
  CHECK: node scripts/verify-confetti-chain.mjs t3
  EXPECT: /t3: extractedevents matchar Confetti-APIt rad för rad/
  EVIDENCE: automatic-evidence=v1; definition-sha256=32dba80e1938bfeebdc192dff28f69b6f2889f078a48134461cf2adbe35c6e27; exit=0; EXPECT=matched; output-sha256=f6470db6265484a65d380daeba351e6e1d70f659fb5571be874b9f816d355ea4; output-bytes=201; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] T4: events finns i Supabase `events` för båda källorna
  CHECK: node scripts/verify-confetti-chain.mjs t4
  EXPECT: /t4: events finns i Supabase/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c5b6a6a6713f220d830d7267a1c687fef74e6910108da030e8ee20b2cf7807f2; exit=0; EXPECT=matched; output-sha256=3765ad959d2000f6e7daee8c77c6b6583963b8f782f4671fa63b0b127936e42b; output-bytes=135; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] T5: gaterna kan FAIL:a — negativ kontroll mot trasig kopia
  CHECK: node scripts/verify-confetti-chain.mjs selftest
  EXPECT: /selftest: gaterna kan faila pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=dd8e85c44f8a517cb6576140696d293e5be730779856b2b64ce66c11f444da61; exit=0; EXPECT=matched; output-sha256=7aac3ecacd48b15642889592f66bc11f5c54cfc01354d7513c3405c9770eeb34; output-bytes=135; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] T6: normalizer skriver venue_full_name/address/city på event-raden
  CHECK: node scripts/verify-confetti-chain.mjs t6
  EXPECT: /t6: normalizer skriver venue_full_\* och raderna har plats/
  EVIDENCE: automatic-evidence=v1; definition-sha256=0498f891f333c2467b1dee1a99854b25a788a8325809ea8c81828d012b2dfbda; exit=0; EXPECT=matched; output-sha256=77e83ed5e7ac65bf61f055e97ed59e89bd8440c5a4ff51d2c0cb376f3144ccfe; output-bytes=180; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Importkedjan: inga event får försvinna på vägen (2026-10-23)

Scope: vägen extractedevents/ → BullMQ `raw_events` → worker → normalizer →
Supabase `events`. Tre tysta förluster hittades på den vägen, alla mätta på
riktiga körningar:

  1. **jobId-granularitet.** jobId byggdes på (source, source_id ?? titel).
     BullMQ dedupear på jobId, så "Sagolek – Den lille prinsen" 10:00 och
     11:30 samma dag kollapsade till ett jobb. Mätt: 1463 framtida rader gav
     1305 jobb — 158 rader försvann tyst.
  2. **Terminalt jobb blockerar re-import.** `queue.add` med ett jobbId som
     redan finns är en tyst no-op, även i KLART läge. Med
     `removeOnComplete: 100` låg de 100 senast klara jobben kvar, så nattens
     re-import av de event som importerades sist blockerades. Mätt: 82 av
     1463.
  3. **Objektfält i JSON-LD.** `organizer`/`location`/`address` är objekt i
     schema.org, och `String(obj)` → '[object Object]'. Mätt: 599 rader i 21
     orelaterade källor bar det, varav 250 var framtida events som landade i
     databasen. Mönstret är General (21 domäner), så fixen sitter i den
     generella normaliseringen — inte i någon källspecifik adapter.

Grundinvarianten för jobId:t är: **granulariteten får aldrig vara finare än
normalizerns dedup-nyckel** (source, source_id) annars (source, titel,
start_time). Då kan BullMQ aldrig kasta bort en rad som normalizern hade
behållit.

- [x] I1: extraktorn läser JSON-LD-objektfält (venue/address/organizer/city)
  CHECK: node scripts/verify-extractor-object-fields.mjs e1
  EXPECT: /e1: extraktorn läser location\/organizer\/address som objekt pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=8cdf7ad9d553cfbb210aaf98daf12d64f3d1eaa717318341999591ed74c82cf6; exit=0; EXPECT=matched; output-sha256=156feb35b7c31f36f17546e09ff535567a56898a4f03d985896343befb746fb5; output-bytes=65; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I2: gaten kan FAIL:a — negativ kontroll mot en extraktor UTAN fixen
  CHECK: node scripts/verify-extractor-object-fields.mjs e2
  EXPECT: /e2: negativ kontroll ger "\[object Object\]" utan fixen — gaten kan faila pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b2745e333d97eab1321e061bce379945e3c6c030ba0b24feb934b405a5100df5; exit=0; EXPECT=matched; output-sha256=f60464869cef46f3afb39405fdb5a35a00e8bde1fcd8e9375d184e73025702a7; output-bytes=79; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I3: inga "[object Object]" kvar i venue_full_name/venue_full_address i databasen
  CHECK: node scripts/verify-extractor-object-fields.mjs e3
  EXPECT: /e3: inga "\[object Object\]" i venue_full_name\/venue_full_address i databasen pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=995f40b994edeb69a7a4a214c30aaf2ef37992897fc7ff706adee9588a4f63a7; exit=0; EXPECT=matched; output-sha256=b18d6ba1e48321bacba43811d01f2d1f67779c553c67a37127907966c3561704; output-bytes=81; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I4: importen tappar INGA rader på vägen till BullMQ
  CHECK: node scripts/verify-import-pipeline.mjs p1
  EXPECT: /p1: \d+ framtida rader → \d+ jobbId, ingen rad försvinner/
  EVIDENCE: automatic-evidence=v1; definition-sha256=837dd1b01512806cd2fc81971064a758f40f52180b47661c4afc34c05e79c3f9; exit=0; EXPECT=matched; output-sha256=50f29bfc2d480e22d8c93c7f1366faa7e1a83452d8b433107a359981d750cf9d; output-bytes=121; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I5: ett terminalt jobb frigörs så att re-import inte blockeras
  CHECK: node scripts/verify-import-pipeline.mjs p2
  EXPECT: /p2: klart jobb frigörs och kan importeras om \(riktig Redis\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=83dc2817e1484e1d33e602fcf7e8e7ef205fca5b917d9402775205c6de69494e; exit=0; EXPECT=matched; output-sha256=3bbe01ddc26dae44692e669b339f0a00c1951caad03819ca6ce7edbd6ef68a82; output-bytes=66; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I6: alla extraherade framtida event finns i databasen
  CHECK: node scripts/verify-import-pipeline.mjs p3
  EXPECT: /p3: alla \d+ extraherade framtida event finns i databasen .*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=7df9bedc953c4e48e92577fe1057a097d1adb3bd5da67ee990402eb82a0b7597; exit=0; EXPECT=matched; output-sha256=f3ae1ef43ece8c07a65445fcaaeb450f943804ebb583899f537a0edc1b1d0da9; output-bytes=131; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I7: regressionstesterna för jobId-granularitet och artefaktskydd passerar
  CHECK: npx vitest run 03-Queue/importToEventPulse.test.ts 04-Normalizer/venue-text-guards.test.ts 02-Ingestion/F-eventExtraction/universal-extractor-object-fields.test.ts
  EXPECT: /Tests\s+\d+ passed \(\d+\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4aa59a9f5b516f37558ba95a35640bb32a457f438c6f4333cc46c5e72e0040da; exit=0; EXPECT=matched; output-sha256=33df84c56f8e2564e7dfbb92b4f98ce1882f64da0902c64584898bbf112faf6e; output-bytes=213; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] I8: städningen är idempotent — en andra körning hittar noll artefakter
  CHECK: node scripts/cleanup-venue-object-artifacts.mjs
  EXPECT: /events med artefakt: 0[\s\S]*venue-rader att radera: 0[\s\S]*dry-run — inget skrevs/
  EVIDENCE: automatic-evidence=v1; definition-sha256=08dc510b835c8f47af5e9fa150c27b709a2b29d6a559749e3b1ab2330ac84773; exit=0; EXPECT=matched; output-sha256=5df863421f656ecc877e46974ffc9b663049de5b97b002df733b10cb45bdb75d; output-bytes=204; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries
  WHY: en gata som bara mäter "jag rensade just nu" bevisar inget. Att den
       andra körningen hittar noll bevisar att databasen faktiskt är ren.

- [x] I9: importen vägrar köra retired/quarantined-källor
  CHECK: npx tsx 03-Queue/importToEventPulse.ts --dry-run --limit 1
  EXPECT: /Hoppar över \d+ retired\/quarantined-källor/
  EVIDENCE: automatic-evidence=v1; definition-sha256=34a050c4d1647fc70dabdee60be44b0f2232a2955c2f5112b35cc4ca47382f7a; exit=0; EXPECT=matched; output-sha256=ec83335ab2a152deb39624d2ae3611ea7757a07ca2ed7949771cc7f04245bc8c; output-bytes=3426; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries
  WHY: scandinavium (retired) skickade 4 framtida rader varje natt som aldrig
       nådde databasen (titeln är venue-namnet, så titel-gate:n kastar dem).
       Importen saknade quarantine-guard — de fyra gates har den, importen
       hade den inte.


# C3-extraktorn: kort, titel och datum (2026-10-24)

Scope: C-gatens HTML-extraktion. Tre fel gjorde att hela venue-kalendrar
missades eller att nyhetssidor producerade påhittade events.

  1. **Layout-wrapper som "kort".** Tailwind-klasserna "items-center" /
     "align-items-center" innehåller delsträngen "item" och matchar
     därför `[class*="item"]`. C3:s `$a.closest(...)` snappar då kortet till
     en tom layoutkolumn i stället för kortets egen post, och evenemanget
     försvinner helt. Bevis (Generalization Protection Rule): 24–25
     orelaterade domäner har samma substring-träff; 13 domäner ändrade
     kortuppslagning. Fixen är *expanderande* — den kan bara skapa events,
     aldrig ta bort.
  2. **Årets siffror som datum.** Regexen för årslösa datum ("23 okt")
     matchade de två sista siffrorna i ett ÅR om de följdes av en månadsnamn.
     "...Through March 2027" + "Sep 30, 2026" blev "27 Sep" → 2027-09-27.
     Fix: lookbehind `(?<!\d)` i fyra regexer.
  3. **Ogiltiga datum/tider lämnade extractorn.** "30-31 oktober" gav
     "2026-31-30"; "35:54" skrevs som klockslag. Fix: validering mot en
     riktig kalenderdag och ett riktigt klockslag.

Fixtures: `scripts/fixtures/*.html` — utklippta ur de RIKTIGA sidorna
(scalateatern.se/forestallningar, rustourismnews.com, musikindustri.se,
postmuseum.se). Ingen syntetisk event-markup.

- [x] X1: positiv kontroll — riktig venue-lista ger events med giltiga datum
  CHECK: node scripts/verify-c3-extractor.mjs x1
  EXPECT: /x1: scalateatern \d+ events.*"31 okt" → 2026-10-31 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=5d57c17a43efafa089c52ec96966a1ca213fee30574ce621b07b36098c02f02c; exit=0; EXPECT=matched; output-sha256=1ae017d3fa5b01d86ef3d3f317ba4ed96946a3d3cc7aafc2d6e11f87e2de4abd; output-bytes=83; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] X2: negativ kontroll — nyhetssidor ger INGA events
  CHECK: node scripts/verify-c3-extractor.mjs x2
  EXPECT: /x2: 3 nyhetssidor gav 0 events pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=bb2d43256cafef2e65a3258223d6e6a194052dcafc19ee13b14b11da2e53cc15; exit=0; EXPECT=matched; output-sha256=24200de4e2b96ffd9bcc26e83a8a50ebebb51f30e3f98fc2e227d5bcf7f6745e; output-bytes=36; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] X3: inga ogiltiga datum eller klockslag lämnar extractorn
  CHECK: node scripts/verify-c3-extractor.mjs x3
  EXPECT: /x3: inga ogiltiga datum eller klockslag i \d+ sidor pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ede9cb28e8219063751e54c35129cefaca164c4a1e033d2fc09e770f10804de3; exit=0; EXPECT=matched; output-sha256=55223ab82c753886ac5a345ce6f18c8daa5907ec3646a82ba724852ecaf924ad; output-bytes=55; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] X4: negativ kontroll mot extraktor UTAN fixen — gaten kan faila
  CHECK: node scripts/verify-c3-extractor.mjs x4
  EXPECT: /x4: utan lookbehind ger nyhetssidorna \d+ skräpeevents — gaten kan faila pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e73d7c2e8e163d002b9ebcaa7f4da67e20c6ba391a634dde8ce889d04b18fd31; exit=0; EXPECT=matched; output-sha256=2fc6637aab4341f96a62660000ea521ee90a5abcaac24faa947205e82487875a; output-bytes=79; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] X5: ingen källa tappar events om den inte är godkänd
  CHECK: node scripts/verify-c3-extractor.mjs x5
  EXPECT: /x5: \d+ källor jämförda, \d+ nedgångar \(alla godkända: .*\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2854a607d2e58e3d5dc6cc23186492367a236bd3e588669788b41e8ca8e2e8c7; exit=0; EXPECT=matched; output-sha256=6150292455665ea9806f42435b68da3c8a6d09212113cc465ca6b1a2d5134864; output-bytes=89; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

---

# C0: sitemap-index expanderas, nästa-kandidat lämnar inget på bordet (2026-10-24)

Scope: C-gatens HTML-väg — hur kandidatsidor väljs (C0) och vad som
händer när vinnaren ger 0 events.

Två fel gjorde att källor dog trots att de hade events:

  1. **.xml-filer vann densitetslopet.** En sitemap-INDEX (/sitemap.xml)
     pekar på sub-sitemap-FILER (/event-sitemap.xml). Varje `<lastmod>` i
     XML:en räknades som ett datum, så .xml-filen fick 50–250× högre
     density än en riktig HTML-sida och vann → C1 svarade "no `<main>`" →
     källan dog.
  2. **Bara vinnaren testades.** C0 rankade och mätte flera kandidater men
     körde vidare bara den bästa. När vinnaren gav 0 events dog källan —
     trots att nästa kandidat hade events.

Fix: sitemap-INDEX expanderas en nivå till sina `<loc>`-barn, `.xml`-rader
mäts aldrig med HTML-formeln, och nästa-kandidat-fallbacken testar upp till
3 alternativ NÄR OCH BARA NÄR vinnaren gav 0 events.

Verifiering: riktiga sajter (moderna museet, Scalateatern, Postmuseum,
Chinateatern) valda ur en riktig körning — de förlorade mot .xml i
batch-214. Live-körningsbevis: 112 av 112 historiska .xml-vinnare gav 0
events; de tre senaste batcharna har 0 .xml-vinnare och 465 events.

Generalization Protection: General — sitemap-INDEX och `<lastmod>` är
Sitemap Protocol 1.1-standard, inte site-specifika konventioner. Ingen ny
IGNORE_PATTERN, ingen ny scoring-vikt.

- [x] C1: positiv kontroll — indexet expanderas till riktiga sidor (live)
  CHECK: node scripts/verify-c0-sitemap.mjs c1
  EXPECT: /c1: \d+\/\d+ sajter expanderade indexet till \d+ sidor, 0 \.xml som sidor \(indexet hade \d+ \.xml-rader\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a11b42bff81fe3a2f4d08ca64c010e999bac7b6bce8320e270003e1ae9ec096d; exit=0; EXPECT=matched; output-sha256=1c58019144f25e6d29507c6f8f952c423182656e81abb88c96d5fb76f17de24f; output-bytes=104; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] C2: negativ kontroll — före-fixens logik ger .xml-kandidater
  CHECK: node scripts/verify-c0-sitemap.mjs c2
  EXPECT: /c2: utan expansionen ger \d+\/\d+ sajter \d+ \.xml-kandidater .* — gaten kan faila pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=058c11dab8cf11e27202f74f10e1ae4521e284774901b01c6f5aa274fe621fc8; exit=0; EXPECT=matched; output-sha256=69223492b7d68a8ac7f270278d1dfb52453a74f371c2e9519f7eaab6bb9f7c3c; output-bytes=134; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] C3: live-körningsbevis — 0 .xml-vinnare, fallbacken sänker inget
  CHECK: node scripts/verify-c0-sitemap.mjs c3
  EXPECT: /c3: senaste batcharna .*: 0 \.xml-vinnare, \d+ events, \d+ nästa-kandidat-källor \(alla med events > 0\); historiskt \d+ \.xml-vinnare med \d+ events pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=49181c4a29f595f592323e123b5c47df67ef7bdae1402b8d9903f28b5ad1ce23; exit=0; EXPECT=matched; output-sha256=ce48d462925d1571bd5d06a5b7526d8eec59771e89bfcfe1645e49ced292675f; output-bytes=179; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

---

# Per-step-timeout: kedjan får inte hänga för evigt (2026-10-24)

Scope: `scripts/ingestion-cron.ts` — steg-ledaren.

Kedjan kan fastna i ett steg som aldrig avslutar. Historiken visar
tribe-events som stod kvar i 419 485 s (116 h) utan att kedjan brytte. En
heartbeat räcker inte — kedjan behöver en HÅRD gräns.

Timeouten är implementerad (`runStep`, `INGESTION_STEP_TIMEOUT_MS`, default
2 h, SIGTERM → SIGKILL efter 30 s, exit=124). Men den hade aldrig KÖRTS: i
`runtime/ingestion-cron/chain-overview.log` (16 574 rader) fanns noll
"step-timeout"-händelser. Ett mekaniskt som aldrig avfyrats är inte bevisat.

För att kunna bevisa den skapades `--only <steg>` på ingestion-cron, så att
ett enda steg kan köras isolerat. Okänt stegnamn är ett fel (exit 2), inte
en tyst "inget att göra" — annars kan en typo få verifieringen att se grön
ut.

Båda gaten kör samma steg (`direct-jsonld`: 16–31 s i 12 av 12 dokumenterade
körningar). Bara tröskeln ändras — 8 s mot 600 s. Beviset läses ur de NYA
raderna i chain-overview.log (radräknaren snapshotas före körningen), så en
tidigare timeout från en annan körning inte kan smyga igenom.

- [x] TO1: positiv kontroll — 8 s-gränsen dödar steget och kedjan avslutar
  CHECK: node scripts/verify-step-timeout.mjs t1
  EXPECT: /t1: direct-jsonld dödad av 8 s-gränsen — step-timeout \+ step-end exit=124 \(\d+ s\), kedjan avslutade med exit=124 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=5bb44dfb182df0e505fe5c2938304a55cb07b3b620f1585dc55866484be4c501; exit=0; EXPECT=matched; output-sha256=2a2aca84640a2e260a2ed47c7dbd088c4de62aa782edc5c4948f39f916be0f8d; output-bytes=120; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] TO2: negativ kontroll — 600 s-gränsen dödar inget steg
  CHECK: node scripts/verify-step-timeout.mjs t2
  EXPECT: /t2: direct-jsonld klarade sig med 600 s-gränsen — exit=0 \(\d+ s\), noll step-timeout pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4d9fc76852bba539a839da6362e1c3f69aa83683856b5acc560754b9ff23d34c; exit=0; EXPECT=matched; output-sha256=e6e79a3b93413965db36cb6be9c72a95eb83d61dd978d63d2331314a112218ed; output-bytes=91; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Pre-kill får inte döda en levande kedjas arbete (2026-10-24)

Scope: `scripts/lib/chain-guard.mjs` + `scripts/ingestion-cron.ts` — städning av discovery-processer.

Nattkörningen 2026-10-24 tog skada av sin egen städning:
`00:21:43` skickades SIGTERM till nattkörningens `discover-subpaths.mjs`
och `00:21:57` till `ingest-direct-jsonld.mjs`. Båda stegen dog med exit=1
**utan FATAL i stderr** — de var SIGTERM:ade, inte trasiga. Signalerna kom
från verifierings-gates som startade `ingestion-cron.ts --only direct-jsonld`
parallellt med nattkörningen. Den gamla logiken matchade bara cmdline-
mönstret och kunde inte se skillnaden mellan en zombie och ett barn av den
kedja som kör JUST NU.

Fixen kontrollerar **ancestor**: har processen en levande ingestion-kedja som
förfader är den levande arbete och lämnas i fred.

Ett eget fel hittades i fixen under verifieringen: `listProcesses()` använde
`split(/\s+/, 12)`, och med en regex som separator behåller `split` INTE
resten av strängen. Varje cmdline klipptes till två ord
(`…/node --require`), så kedjemönstret matchade aldrig — `liveChainPids()`
returnerade alltid `[]` och `chainPids` var alltid tom. Det hade gjort
pre-kill döda kedjans egna barn, precis som den ursprungliga buggen.
PK0 finns till för att fånga exakt den klassen.

- [x] PK0: cmdline-parsningen får inte klippa — kedjemönstret måste matcha
  CHECK: node scripts/verify-prekill.mjs pk0
  EXPECT: /pk0: full cmdline läst \(\d+ tecken\) och den falska kedjan hittades av liveChainPids\(\) — parsningen klipper inte pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=0ee84851d3c039c648e9c03f493538da3ee43a96764ce2218500efb73ff890ff; exit=0; EXPECT=matched; output-sha256=afd2ef9150c8b5dccfe7464a0a02537d68fa13c59cbea0bf4269cf1fa3849363; output-bytes=120; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] PK1: negativ kontroll — en orphan utan levande kedje-förfader döds fortfarande
  CHECK: node scripts/verify-prekill.mjs pk1
  EXPECT: /pk1: orphan utan levande kedje-förfader dödades \(pid \d+\) — städningen fungerar fortfarande pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=af8dbfd3d0125f8c5a3f948b9afddb872ea6d4fbe23a2829cddf2a88d12ff6a4; exit=0; EXPECT=matched; output-sha256=6c7d6c7cb8103fbcb9ebe11ee2cfc7beeb8313466ecc71e2ab56b1dd6347b21e; output-bytes=104; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] PK2: positiv kontroll — ett barn till en LEVANDE kedja överlever
  CHECK: node scripts/verify-prekill.mjs pk2
  EXPECT: /pk2: barn till levande kedja \(pid \d+\) skippades av pre-kill — kedjans pågående steg lever vidare pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=670b70409fe7601bec336dbc64d8f3fba849e9143fbd5cf8cb89a5c3e0a529b9; exit=0; EXPECT=matched; output-sha256=1cf30aa457ae4cd6f8d2aa54ab4c4d231836b8df370d2eb76843b3a68c7d7984; output-bytes=109; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Gater vägrar köra parallellt med produktionen (2026-10-24)

Scope: `scripts/verify-step-timeout.mjs` — konkurrens-skydd.

En gate som startar ett riktigt produktionssteg mäter ingenting när
nattkörningen kör parallellt — den krockar med den. TO1/TO2 vägrar därför
köra så länge en ingestion-kedja lever. TO3 bevisar att vägran faktiskt
händer: en falsk kedje startas, och gaten måste avbryta med ett tydligt
meddelande.

- [x] TO3: concurrency-guard — gaten vägrar köra när en kedja lever
  CHECK: node scripts/verify-step-timeout.mjs t3
  EXPECT: /t3: gaten vägrade köra medan en ingestion-kedja levde \(pid \d+\) — mätvärde och inte krock pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e16b59c3813a69efed8bd67a0738f75cd80e8bac8ff4242b2ec53ae525e944f5; exit=0; EXPECT=matched; output-sha256=009a7c919638437eb3efd4f861a7b27957c47492d5b4da54f0dce6299f7fc5b7; output-bytes=103; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# e4-ordningsgaten kan faila (2026-10-24)

Scope: `scripts/verify-fixes.mjs` (e4) + `scripts/verify-e4-order.mjs`.

e4 mäter om P3D kördes FÖRE A i samma kedja. Gaten var FEL definierad: den
tog "sista körningen" ur chain-overview.log, vilket numera kan vara en
`--only <steg>`-körning från en verifierings-gate — en körning som varken
har P3D eller A. Nu väljer gaten den senaste körning som har BÅDA stegen.
Men en gata som bara kan ge grönt är inte ett bevis: E12 bygger en
syntetisk logg där P3D avslutas EFTER A och kräver att e4 faller.

- [x] E12: negativ kontroll — e4 faller när P3D kom efter A
  CHECK: node scripts/verify-e4-order.mjs e1
  EXPECT: /e1: e4 faller när P3D kommer efter A \(exit=\d+\) och passerar ordningsgranskningen när P3D kommer först — gaten kan faila pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=bf9c19c1f8ff26f611a3b3441268c73415d6f1c5614cd1fc67475f8d0ff9632f; exit=0; EXPECT=matched; output-sha256=4fe1212983100417ff9d76f06118a6f610081b5e34af7ec0a8358882fdc2f432; output-bytes=129; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# C0 faller tillbaka till domänroten när källans URL inte svarar (2026-10-24)

Scope: `02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts` — kandidatdiscovery.

Källans URL pekar ofta på EN event-sida. När evenemanget är slut ger sidan
404, och C0 avslutade då med 0 kandidater FÖRE sitemap-discovery — även om
domänroten levde och hade en sitemap med eventsidor.

Mätt på riktiga spårade källor (`scripts/probe-root-fallback.mjs`): 4 av 189
hade död URL men levande rot, över 3 domäner (3arena.se, aviciiarena.se ×2,
billetto.se). Tre av dem var dubbletter av källor som redan täcker samma
verket och är nu begravda som `coverage.duplicate_of`.

Fixen är en RESILIENS-fallback: ingen IGNORE_PATTERN, ingen scoringvikt och
ingen URL-token-regel ändras, och kandidatrankningen är oförändrad för
sajter vars URL fungerar.

- [x] RF0: enhetstest — fallbacken används, men bara när roten svarar (negativ kontroll med)
  CHECK: npx vitest run 02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.test.ts --reporter=verbose
  EXPECT: /rot-fallback till domänroten > använder domänroten när källans URL inte svarar.*rot-fallback till domänroten > avslutar med 0 kandidater/s
  EVIDENCE: automatic-evidence=v1; definition-sha256=ceebb143088f108903974c43e0b3935f8b00e713622d106f9edf99041042b2fd; exit=0; EXPECT=matched; output-sha256=3b334c2075ec0e9dbd1fc39207076a6115689418519651acffdf93bc2fc472c4; output-bytes=6539; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RF1: live — en spårad källa med död URL hittar kandidater via domänroten
  CHECK: npx tsx scripts/verify-c0-root-fallback.mjs rf1
  EXPECT: /rf1: billetto-stockholm .* föll tillbaka till https:\/\/billetto\.se och hittade \d+ kandidater .* pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=cf83cb4613262ab3571d06826e58188576496ce26713bc223cf44fd45be7ee65; exit=0; EXPECT=matched; output-sha256=c16df30ab68182572e81f60de3e76f56f44200af3aa0e01b810e5eb7fed0d337; output-bytes=307; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Handoff mellan gates räknas inte som fel (2026-10-24)

Scope: `02-Ingestion/tools/sourceRegistry.ts` (status-maskinen),
`02-Ingestion/A-directAPI-networkGate/runA.ts`, `02-Ingestion/B-JSON-feedGate/runB.ts`,
`02-Ingestion/C-htmlGate/run-dynamic-pool.ts`, `scripts/requeue-sources.mjs`,
`scripts/restore-handoff-quarantined.mjs`, `scripts/verify-handoff.ts`.

B-gaten lämnade över källor till C-gaten med `success: false` utan error-sträng.
Status-maskinen räknade det som ett fel → consecutiveFailures++ → auto-quarantine
vid 5. Under en natt karantänades 56 källor, och C-gatens pool-build droppade
dem innan de kördes: "[AUDIT] 56/64 sources dropped from postB-preC pool build:
- astronomiska-huddinge: url_missing_from_sources". De körligheten var alltså
aldrig fram till C.

Fixen: en handoff får egen status `routed`, räknas aldrig som fel och kan
aldrig auto-quarantenas. C-gaten skriver nu även sitt terminala utfall, så
felräknaren speglar verkliga extraktionsfel i stället för handoffs.

- [x] RQ0: handoff ger status routed, räknar inte fel och karantänens aldrig (negativ kontroll: verkligt fel karantänas vid 5)
  CHECK: npx tsx scripts/verify-handoff.ts h1
  EXPECT: /h1: 8 handoffs → status routed, consecutiveFailures=0, ingen karantän; negativ kontroll: 5 verkliga fel → karantän \(kontrollen kan faila\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=7677a98bc40af4eaf8a32b5bea2bf5cee72dc5f36fbd27b7b4d92b7fbf32393c; exit=0; EXPECT=matched; output-sha256=cd2fdbc53c78b8af819f015c06bfb569621368870e749ae3ba9b16dba889ee2f; output-bytes=149; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ1: ingen källa ligger auto-karantänad med handoff-signatur (negativ kontroll: injicerad rad upptäcks)
  CHECK: npx tsx scripts/verify-handoff.ts h2
  EXPECT: /h2: \d+ karantänrader, ingen med handoff-signatur — ingen källa är begravd innan nästa gate kör den; injicerad rad upptäcks \(kontrollen kan faila\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b68098bc744f41bc681afe38e37c9a71dd007a14980a074754502b1e1464f410; exit=0; EXPECT=matched; output-sha256=41343abf8bdaf3de4a09bcca2669bd513eaedc5be97a1360b2917ba44d68a0b7; output-bytes=160; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ2: C-gatens senaste körning droppar 0 källor ur poolen (negativ kontroll: syntetisk logg upptäcks)
  CHECK: npx tsx scripts/verify-handoff.ts h3
  EXPECT: /h3: senaste C-körningen \(.*\) droppade 0 källor ur poolen; negativ kontroll: syntetisk logg med 56 droppade källor upptäcks \(kontrollen kan faila\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=797c2169b2ba0a1235e2269f50ac339ae735d208e4f449adb70cb0a9c2a45f25; exit=0; EXPECT=matched; output-sha256=cc9bc6e395a921ee616a9059017b4f6e043d1887d2c6c198e1f6435764ef6a5b; output-bytes=192; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ3: A-gatens handoff-regel — routingbeslut är handoff, transportfel är fel (negativ kontroll: transportfel räknas inte som handoff)
  CHECK: npx vitest run 02-Ingestion/A-directAPI-networkGate/handoffRule.test.ts --reporter=verbose
  EXPECT: /(?=.*behandlar transportfel som fel, inte handoff)(?=.*behandlar "sidan svarade men saknar JSON-LD" som handoff)/s
  EVIDENCE: automatic-evidence=v1; definition-sha256=c47e76c164c6c3d7b858ac33971837749e01cecf3c8cd28827b5124758e22598; exit=0; EXPECT=matched; output-sha256=e8f73298e8810bc4a4448d514bcf7c6ad8c3a33a30a438cbdc06445e0dc4c433; output-bytes=1073; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ4: återköningsverktyget lägger en spårad källa i preA-kön och avvisar en okänd (negativ kontroll med)
  CHECK: node scripts/verify-requeue.mjs rq1
  EXPECT: /rq1: .* lades i preA-kön \(reason=".*"\) och en okänd källa avvisades utan att skrivas — återköningsvägen fungerar och kan inte ta emot skräp pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=dd49f97a392833e9c5a14f426098c1cefc2c20950057bb84ed8afe8f42d8f927; exit=0; EXPECT=matched; output-sha256=8df3eb980241fab9b016ab8d4a9bb70fb127edb5b5a491a1cd1bc8cfccb173ae; output-bytes=199; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ5: karantänindexet har inga stale rader (negativ kontroll: injicerad stale rad upptäcks)
  CHECK: node scripts/verify-requeue.mjs qi1
  EXPECT: /qi1: \d+ karantänrader har alla fil i sources\/_quarantine\/ — ingen källa är osynlig för A- och C-gaten, och reconcilen upptäcker en injicerad stale rad \(kontrollen kan faila\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=6ba09773d3f3d8c61712272856499f6e8653f811a6486c3cbcdbd3afc4bcf19a; exit=0; EXPECT=matched; output-sha256=39ffcb141b6f3a554dc987ba1416c533c9de5597ffe3adbcc434163c5f84db50; output-bytes=187; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

## Throttling (429) — självprovocerad WAF-blockering (2026-10-24)

C-gaten anropar samma värd många gånger i samma körning (sitemap →
kandidatsidor → C1-subpaths → C2/C3-hämtning, upp till 3 rundor). Flera
svenska sajter svarar då 429. Uppmätt på blekholmen.se: ~12 snabba anrop →
429 i ~30 s, sedan 200 igen. Utan retry skrev C-gaten det 429 som
"fetch error" och begravde levande källor för att vi själva höll på för
mycket.

Samma mönster mättes på sju orelaterade domäner (blekholmen.se,
momentsapp.no, cirkus.se, folketshus.se, galeasen.se, filborna.se,
ifkstockholm.se) — generellt, inte sajt-specifikt. Användar-Agenten är
irrelevant (identiska statuskoder för EventPulse/1.0 och Chrome/125.0).

Fixen ligger i `02-Ingestion/tools/fetchTools.ts`: `fetchHtml` gör nu retry
med backoff på 429/503 och respekterar `Retry-After`. 404/403/DNS är
fortfarande omedelbara fel — de begravs korrekt.

- [x] RQ6: throttle-retry — 429 försöks om, men ett 404 gör det inte (negativ kontroll med)
  CHECK: npx vitest run 02-Ingestion/tools/fetchTools.throttle.test.ts --reporter=verbose
  EXPECT: /försöker igen efter 429 och lyckas när sajten svarar 200.*NEGATIV KONTROLL — försöker inte om ett 404/s
  EVIDENCE: automatic-evidence=v1; definition-sha256=4bcb253f4e5fe28cfb29cb4866e46f257fd703dc78fb9549a9f6f913f2233ef0; exit=0; EXPECT=matched; output-sha256=74c34eb3cad91582da5c71c3ebb953afae819846a06f53ae58a12ac724b0488b; output-bytes=690; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ7: live — de sju throttling-drabbade källorna begravs inte längre på grund av 429 i C-gaten (negativ kontroll: syntetisk 429-begravning upptäcks; positiv kontroll: 429-handoff flaggas inte)
  CHECK: npx tsx scripts/verify-throttle.ts t1
  EXPECT: /t1: ingen av 7 throttling-drabbade källor BEGRAVDES på grund av 429 i senaste C-körningen .*negativ kontroll: syntetisk 429-begravning upptäcks \(kontrollen kan faila\); positiv kontroll: 429-handoff flaggas inte pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=84e7eee5119838ffeb0a41466a955c26c39c475a09107dae0e21eba0159789aa; exit=0; EXPECT=matched; output-sha256=5df0570538611ded4f07dae99deff2655a2a10e192a93a3fd09035974f5dad91; output-bytes=231; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] RQ8: per-värd-spacing — samma värd får max ~6 anrop per 10 s (negativ kontroll: olika värd blockeras inte)
  CHECK: npx vitest run 02-Ingestion/tools/fetchTools.spacing.test.ts --reporter=verbose
  EXPECT: /håller minst ~2 s mellan anrop mot samma värd.*NEGATIV KONTROLL — blockerar inte anrop mot andra värd.*NEGATIV KONTROLL — 404 försöks inte om/s
  EVIDENCE: automatic-evidence=v1; definition-sha256=e9bad280af71bb17405e3955dd44e4e8bd26fbabf60a4833752fcfe05bc4dead; exit=0; EXPECT=matched; output-sha256=23b8f174d2791ee2fc68520b502d0d5a481de63fa588a68140935843e344c9a0; output-bytes=638; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# D-gatens tvåstegs-listingcrawl (2026-10-24)

Scope: en aggregator (billetto) har sina events bakom en JS-renderad
listningssida. D-gatens vanliga väg renderar EN sida per källa — för en
listningssida ger det 0 events, bara länkar. Tvåstegs-crawlen gör
listningssidan → event-URL:er → event-sidor, där JSON-LD finns.

Ny kod: `02-Ingestion/D-renderGate/runD-listing-crawl.ts` (körningen),
`02-Ingestion/D-renderGate/listingCrawlCore.ts` (rena funktioner, 23
enhetstester), `scripts/verify-listing-crawl.mjs` (gaterna nedan).

Ingen C-lager-ändring gjordes — all billetto-specifik kunskap ligger i
källans egen `metadata` (categoryUrls, eventHrefPattern, scope). Scope-
filtret (postnummerprefix 1xxxx = Stockholms län + ortnamn) är generellt
och mätt på riktiga körningar, inte sajt-specifikt.

Varje gate bär en negativ kontroll. lc2 kör dessutom ordningskontrollen mot
två medvetet felaktiga cron-texter, så kontrollen kan inte vara en gata som
bara kan ge grönt.

- [x] LC0: D-filen innehåller riktiga ParsedEvent-rader med listing-crawl-signal
  CHECK: node scripts/verify-listing-crawl.mjs lc0
  EXPECT: /lc0: \d+\/\d+ rader i D-filen är riktiga ParsedEvent.*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e573a7d68994fce98e50db666182e84f2748d4f2d003c39c82ab63f32a690559; exit=0; EXPECT=matched; output-sha256=a7575fb8526ee682f0f0e119a36d4fb54f9c2f30b1f1d1059de83eb54046b320; output-bytes=191; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] LC1: källans status speglar att crawlen gav events (inte "död")
  CHECK: node scripts/verify-listing-crawl.mjs lc1
  EXPECT: /lc1: källan "billetto-stockholm" har status success, lastEventsFound=\d+.*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=8798ae92cd785f71f285f636d57e82ae711c036e1e1cc591b53457f65969a32c; exit=0; EXPECT=matched; output-sha256=eca67b7404d3f1195c95fa88b8583382f2a374ebe115daa56aef9cce6dee5c6b; output-bytes=141; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] LC2: cron-kedjan kör steget, i rätt ordning (negativ kontroll: båda felordningarna underkänns)
  CHECK: node scripts/verify-listing-crawl.mjs lc2
  EXPECT: /lc2: cron-kedjan kör D-listing-crawl efter D-renderGate och före import-to-eventpulse.*negativ kontroll.*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=cd0e7062b7b3db7435ce83b0f030f32db235a74f7b053bb77f43cd8d2a1c130d; exit=0; EXPECT=matched; output-sha256=60dfe231aa49f69dd21f43af31d95ac7e3ff8a06d8809f6900a7234d25f41b0a; output-bytes=170; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] LC3: ett extraherat event-URL svarar 200 (eventsen är inte påhittade)
  CHECK: node scripts/verify-listing-crawl.mjs lc3
  EXPECT: /lc3: \d+\/\d+ kontrollerade event-URL:er svarade 200.*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=602c1c22b581d299ac1c758a23194a5cad87f61d9c6291a7868e19516b031e67; exit=0; EXPECT=matched; output-sha256=b4a4f1585553c9a0f42d08ae617d3deb2af1d36a3fed887cd46432e368d6b55c; output-bytes=95; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] LC4: en riktig körning släppte igenom scope-filtret (negativ kontroll: Göteborg underkänns)
  CHECK: node scripts/verify-listing-crawl.mjs lc4
  EXPECT: /lc4: scope-filtret har underkänt \d+ utom-Stockholm-events.*negativ kontroll.*pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=86308231b5750d50ad28c0d3570a30d6ae324cfdb41d85819b35742aa0246922; exit=0; EXPECT=matched; output-sha256=2c16d345d722836101a5706f4c90250844000279f25dc2c62f78f66bd760e27b; output-bytes=176; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] LC5: listing-crawlens rena funktioner är enhetstestade (23 tester)
  CHECK: npx vitest run 02-Ingestion/D-renderGate/listingCrawlCore.test.ts --reporter=verbose
  EXPECT: /Tests\s+23 passed \(23\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=180f94733cff1a2451612f10639dc5a4ced5e667c78fe5a06b91a2278c14488b; exit=0; EXPECT=matched; output-sha256=e40f4c1add2e5df303a07547411d7fa2c6b6c8c2381025997a4a46079e43eea2; output-bytes=2934; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Källfilens format: sources/*.jsonl måste vara giltig JSONL (2026-10-24)

Scope: `sources/*.jsonl` är "en källa per fil, ett JSON-objekt per rad".
Flera läsare parsar bara första raden. `sourceRegistry.updateSourceMetadata()`
skrev pretty-printad JSON, vilket gjorde de fem källor som fått en
metadata-uppdatering OSYNLIGA för dem — tyst, utan fel. RF1-gaten sa
"källan billetto-stockholm finns inte i sources/" fast källan var där.

Fixen: registret skriver en rad (som discovery-promotorn alltid gjort),
de fem befintliga filerna normaliserades, och läsarna använder nu
`scripts/lib/readSourceFile.mjs` som tolererar båda formaten.

- [x] SF1: registry skriver en rad, alla källfiler är giltig enradig JSON (negativ kontroll: flerradig/ogiltig/tom fil underkänns)
  CHECK: npx tsx scripts/verify-source-file-format.ts sf1
  EXPECT: /sf1: registry skriver en rad och alla \d+ källfiler i sources\/ är giltig enradig JSON; negativ kontroll: flerradig\/ogiltig\/tom fil underkänns pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=812f9941a9045fe974646d657b5acd4027e5d39a36f7da2f93b9e25c7d8941cc; exit=0; EXPECT=matched; output-sha256=b9d6d01a7385b8ec129f9f044dbe77a21d4e7be23e4f490d908e538b8119c28e; output-bytes=150; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# C3-AI needs_render → D-renderGate (2026-10-24)

Scope: C3-AI kan säga att sidan BEHÖVER renderas (`aiVerdict='needs_render'`).
Det är D-gatens signal, inte ett extraktionsfel. Signalen ignorerades, så
källor med C2-score under tröskeln 20 hamnade i `manual-review` — alltså
begravdes — i stället för att få en riktig render.

Bevis (Generalization Protection Rule — 4 orelaterade domäner, samtliga med
C2-score under tröskeln): vasamuseet.se (12), www.vasamuseet.se (9),
www.botaniska.se (8), svenskfotboll.se (12). Kontrollfall med hög C2-score
(lth 26, thatsup 46/47, kalmar 55, modernamuseet 39) gick redan till D via
OPTIMIZATION B och ledde till 1–7 events — ingen av dem begravdes.

- [x] N1: C3-AI:s "needs_render" routar till D-renderGate, inte till begravning
  CHECK: node scripts/verify-fixes.mjs n1
  EXPECT: /n1: needs_render → D-renderGate pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=588d63ffcc90b1ce8a49c7291adb79a811fc50ac644aba0dfbba1a48960d8334; exit=0; EXPECT=matched; output-sha256=8a1c51a5531c950a86d3e5abad07727d750a03ebbae5b83965cc22570ab435ed; output-bytes=132; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Datum-formade titlar är inte event-namn (2026-10-24)

Scope: vasamuseet.se lägger datumet i en `<h2>` och evenemangets namn i en
`<h3>` i samma kort. Extractorn tog den FÖRSTA rubriken → sex events med
titeln "6 NOV, 14:30".

Bevis (Generalization Protection Rule — 3 orelaterade domäner, samma mönster:
datumrubrik före titelfrubrik i samma kort): vasamuseet.se (6 kort),
fallan.nu (38 kort), folkoperan.se (1 kort).

Negativ kontroll i samma gate: hela det extraherade korpuset (6383 rader)
gicks igenom — endast 8 titlar var datumformade, samtliga verkliga
skräptitlar. 47 tester, inklusive att en titel som BÖRJAR med ett datum
("1 MAJ – EFTERFESTEN MED KSMB") behålls.

- [x] DT1: en rubrik som bara är ett datum ger inte eventets titel (negativ kontroll: titel som börjar med datum behålls)
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/dateOnlyTitles.test.ts 02-Ingestion/F-eventExtraction/universal-extractor-date-title.test.ts
  EXPECT: /Tests\s+47 passed \(47\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=6d7e812df03a5cd2ea11b9242168341d95d218af358a6301ea171a0114ab37b7; exit=0; EXPECT=matched; output-sha256=226ec2e3ee8aa80e74522fd656271e60a30cd0853ea5ff8124b4dd3116a0a4cb; output-bytes=213; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Drainens worker-concurrency (2026-10-24)

Scope: `03-Queue/queue.ts` hårdkodade worker-concurrency till 5. Mätt
45,4 jobb/min. Nattens import köar ~5 300 jobb men cron-stegets budget är
90 minuter — 45,4 × 90 ≈ 4 086 jobb. Kön växte alltså varje natt, och
eventsen syntes i databasen först flera nätter senare.

Gaten mäter på riktig kö (inga syntetiska jobb): två drain-körningar med
concurrency 5 respektive 10, räknar "[worker] Job completed"-rader, och
kräver att den högre concurrencyn ÄR snabbare. Varje räknat jobb är en
riktig normalisering som persisterat ett event i Supabase.

- [x] N2: drainens worker-concurrency är mätbar, och högre concurrency ger mer
  CHECK: node scripts/verify-fixes.mjs n2
  EXPECT: /n2: concurrency mätbar och högre ger mer pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ccb82c2dff51ac5bbbfaba8851cbdb81d14bb9fe2f452c15c94d6f6e22867d83; exit=0; EXPECT=matched; output-sha256=4efc6d16961d28d3a787b4902bca31d2bc8a6fead2b3a70bb1738ea467dc3743; output-bytes=179; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Sitemap-fixarna: subtyper, källans egen URL, levbevis (2026-10-24)

Scope: `scripts/ingest-sitemap-discovery.mjs`, `scripts/lib/eventExtraction.mjs`,
`scripts/lib/sitemapDiscovery.mjs`, `02-Ingestion/F-eventExtraction/extractor.ts`.

Tre fel gjorde att sitemap-discovery persisterade nästan inget. Mätt på de
189 spårade källorna: `future` 672 → 1153 och `persisted` 5 → 211 efter fixen.

1. `@type === 'Event'` kastade bort ALLA schema.org-subtyper. Mätt:
   MusicEvent (concerts50.com — 33 events), VisualArtsEvent
   (konstkalendern.com), ExhibitionEvent (stockholm.fotografiska.com).
   Listan speglar den kanoniska extractorn i
   `02-Ingestion/F-eventExtraction/extractor.ts`, som själv grundades på
   spelning.se + sodrateatern — alltså redan bevisad på flera orelaterade
   domäner. Spegeln (.mjs) kan inte importera .ts (skriptet ska köras med
   ren `node`), så listorna hålls i synk av paritetskontrollen i SM1.
2. Källans EGEN URL var inte en kandidat. 124 framtida events ligger på
   källans egen URL (t.ex. `nalen.com/sv/konsert/kleerup` bär JSON-LD men
   finns ingen listing att hitta). Regeln ligger i
   `scripts/lib/sitemapDiscovery.mjs` → `buildCandidateUrls`, så SM2 testar
   samma kodväg som körningen använder.
3. Urvalet tog sitemapsens huvud (arkivet) i stället för de nyaste via
   `<lastmod>`, och sökvägen sökte på källans undersida i stället för
   ursprunget. Det täcks av SM4.

Varje gate har negativ kontroll, och varje gate är verifierad att KUNNA
faila: med `MusicEvent` borttaget ur spegeln faller SM1, med regeln ur
körvägen faller SM2, med spegeln utan källans URL faller SM2 igen.

- [x] SM1: schema.org Event-subtyper accepteras, och spegeln är i paritet med den kanoniska extractorn
  CHECK: node scripts/verify-fixes.mjs s1
  EXPECT: /s1: subtyper=\d+ paritet=ok negativ=\d+ avvisade music=1 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ad0e0482602fc6d8e10295c00e7b545f37607c140334a88dc27eb8b347b2a8dd; exit=0; EXPECT=matched; output-sha256=c8ace2af2d8a1fc7c6e5d1bc6be4de4e3d7d0eaedbe1c4f5467e482f2fd5405b; output-bytes=60; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SM2: källans egen URL är en kandidat och bär riktiga events (levbevis via riktiga skriptet)
  CHECK: node scripts/verify-fixes.mjs s2
  EXPECT: /s2: egen_url=1 .*fetched=\d+ egna_events=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e0c106f91911d4e391f7b57aea10c8f9e52fd27d0f45b331a4aae10918ab6a4c; exit=0; EXPECT=matched; output-sha256=c71da719b6c7e80b81daf3b6f0282486fe1a75b6d9ff71f6dcefd51eead0a77d; output-bytes=90; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SM3: fixen öppnade källor har framtida rader i DB (negativ kontroll: spent källa ger noll)
  CHECK: node scripts/verify-fixes.mjs s3
  EXPECT: /s3: concerts50com=\d+ sodrateatern=\d+ aviciiarena=\d+ negativ=stockholmjazz noll av \d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=11e0c3e58a23d807470904ee4f46e7589530d6efb437a8eae2ae7ed190c35ea6; exit=0; EXPECT=matched; output-sha256=78124b3153c5c52c58ee22563450109c44cdfcc0934113facaaef7dd9090b169; output-bytes=90; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SM4: bibliotekets enhetstester — sitemap-urval via lastmod, sökväg vid ursprunget, subtyper, paritet
  CHECK: npx vitest run scripts/lib/
  EXPECT: /Tests\s+20 passed \(20\)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f00b3804a6955057627fc05679502ae522131ae503197eb35e2b361642dd329c; exit=0; EXPECT=matched; output-sha256=fffac15e34622fa59345ad3d8c1d3f22dc0481501a83a8dc7a58ed73e6afe17f; output-bytes=211; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Datumintervall i extraktorn: det FÖRSTA intervallet vinner (2026-10-24)

Scope: `02-Ingestion/F-eventExtraction/universal-extractor.ts` (och dess
tester), `scripts/verify-date-ranges.ts`.

Ett svenskt datumintervall ("12-14 januari 2027", "3 oktober 2026 – 28
februari 2027") är ETT event som pågår start → slut. Fixen som infördes
2026-10-24 ändrade två saker:

1. **Det första intervallet i texten vinner** — oavsett om det är ett vanligt
   intervall eller ett korsmånadsintervall. Innan fixen tog C1:s
   prioritetsordning (form → ordning), så att korsmånadsintervallet
   slogs över ett tidigare, enklare intervall. Följd: djurgarden.se
   ("den 24–25 oktober och 31 oktober–1 november") fick starten 31 oktober
   i stället för 24 oktober.
2. **Ett intervall med utskrivet år vinner alltid** — även om ett årslöst
   intervall står först i texten. Bevis: dansenshus.se ("7-8 maj 2026" +
   ett avklippt "5-13 maj…" i samma kort).

Regel 1 är **General** enligt Generalization Protection Rule: att en text
nämner två intervall i samma mening är generell svensk formulering, inte
ett sitedomänsdrag. Korpuset: 4 av 128 kort med intervall har fler än ett,
varav 3 upprepar samma intervall.

**Varför en egen oracle.** En gate som bara kör produktionens egna tester
bevisar att koden gör vad den gjorde i går. `scripts/verify-date-ranges.ts`
bygger en oracle som är skriven oberoende av extraktorn — egen regex, egen
årshärledning, egen valregel — och jämför den med extraktorns verkliga
utdata på riktig korpustext (155 rader) och på åtta handskrivna fixturer.

**Varför en negativ kontroll (DR2).** Utan den bevisar DR1 ingenting: en
oracle som alltid håller med om allt är värdelös. DR2 muterar en KOPIA av
extraktorn (temp-fil i samma katalog — originalet rörs aldrig) på tre
sätt, en regel i tag, och kräver att varje mutation upptäcks av oracle.
Mutationerna: "sista intervallet vinner", "lookbehind-skyddet bort" och
"årslöst vinner före med år".

- [x] DR1: extraktorn ligger inom oracle-fönstret på hela korpusen och ger de handskrivna värdena på fixtursetet
  CHECK: node scripts/verify-fixes.mjs dr1
  EXPECT: /dr1: fixtrar=\d+ rader=\d+ avvikelser=0 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9b2c24b6589957d4679e66d17936453151045252375171734cd776d8db83422d; exit=0; EXPECT=matched; output-sha256=fb336f1db299468530704d73280d1b7a97f6fa5b8e7d58de8fcd3648069cc2eb; output-bytes=43; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] DR2: negativ kontroll — tre muterade extraktorkopior upptäcks av oracle (utan denna gate bevisar DR1 ingenting)
  CHECK: node scripts/verify-fixes.mjs dr2
  EXPECT: /dr2: negativ kontroll .* fixtrar=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=c50dc60b32b7d434a568d20fe4c8d36eb84836f69a9dec3e636206ad1e271f94; exit=0; EXPECT=matched; output-sha256=bebd15223091079b9c58e5d3e4f3a5e6778cd16e937782e06d330722a0fe7e84; output-bytes=250; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] DR3: live C-körning — de berörda källorna producerar events med giltiga datum (endast FRSKA filer, ändrade inom 24 timmar, räknas som bevis)
  CHECK: node scripts/verify-fixes.mjs dr3
  EXPECT: /dr3: källor=\d+ events=\d+ ogiltiga=0 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=75227da629a416864a7e1f42f803f4efe6691e4fa95894b3c972ffad8042112f; exit=0; EXPECT=matched; output-sha256=2dcead8870505672a1abd765930253ccd0339cbd82dddc7618f47547bca7d930; output-bytes=43; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] DR4: enhetstesterna för datumintervall passerar (inklusive de negativa kontrollerna för månadsnamn och lookbehind)
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/universal-extractor-date-range.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2ca352849bbe02f1ab21a80d1af7b420a8720183c9e4b3f5570777c123bf6e0a; exit=0; EXPECT=matched; output-sha256=e77190b85c00e902664ce160b0c689d587c69345ff58ab97a0d7b0e5845abf94; output-bytes=213; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Tom datetime-attribut: extraktorn ska inte hitta på ett datum av blanksteg (2026-10-24)

Scope: `02-Ingestion/F-eventExtraction/universal-extractor.ts` (och dess
tester), `02-Ingestion/F-eventExtraction/universal-extractor-blank-date.test.ts`.

En tom `datetime`-attribut ("<time datetime='\n  '>") gav ett "datum" av
blanksteg. Följden var dubbel:

1. Importen kastade bort raden (datumet var inte giltigt), så eventet kom
   aldrig in i databasen.
2. Extraktorn AVSLUTADE sin datumjakt så fort den sett attributet — kortets
   riktiga datum ("17 oktober 2026") lästes aldrig. Kortet gav därför 0
   användbara events, varje gång, trots att datumet stod tydligt i brödtexten.

Punkt 2 är den som gjorde källor "fastna".

**Fixen (tre delar, alla General):**

- `parseDate` ger ETT giltigt datum eller ingenting. Sista utvägen var
  `raw.slice(0, 10)` på godtycklig text — den skrev ut blanksteg som datum.
- `extractDate` fortsätter sökningen i korttexten när attributet inte ger
  ett giltigt datum, i stället för att ge upp.
- `DATE_PATTERNS[0]` skriver inte längre klockan in i date-fältet
  ("2026-04-13 01:00:00" → "2026-04-13").

**Bevis för General (Generalization Protection Rule):** 15 orelaterade
domaner gav blanksteg-datum — 3arena.se, liseberg.se, lund.se,
malm-konserthus.se, malm-live.se, molndals-futsal.se, oland.se,
studio-acusticum.se, kungsbacka.se, goteborgs-litteraturhus.se,
svenska-tennisf-rbundet.se, lth.se, malarenergi-arena.se, liseberg-n-je.se,
malmo-live.se. Det är HTML-kontraktet, inte ett sitedomänsdrag.

**Negativa kontroller i testet (fyra stycken):** kort utan datum ger INGA
events (fixen får inte hitta på datum); en giltig `datetime` vinner
fortfarande över brödtexten; `data-date` med blanksteg faller tillbaka till
korttexten; date-fältet får aldrig bära en klocktid.

- [x] BD1: enhetstesterna för blankstegsdatum passerar (7 tester, varav fyra negativa kontroller)
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/universal-extractor-blank-date.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=68fd780268511197abf4c89e61bb971775fb33328a1d3442852de76593ced751; exit=0; EXPECT=matched; output-sha256=43555292ce4ba2e32d6f32bfe95f53e321e4fa3c00a5a3c7e7ca5ccdcaa13b9d; output-bytes=211; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] BD2: hela extraktorns testsvit är grönt — ingen regression av de tre delfixarna
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=13e312eff1060baa85c43d0b1abacf3cf3fc3096f20d14a3eaa75aff92efb95d; exit=0; EXPECT=matched; output-sha256=1c8f4311ee46ece5513938b804e1898392ceee95c041334b2deb0d514853cee3; output-bytes=218; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

# Statusen i sources_status.jsonl får inte ljuga (2026-10-24)

Scope: `02-Ingestion/D-renderGate/runD-scrapingbee.ts`,
`02-Ingestion/C-htmlGate/run-dynamic-pool.ts`,
`scripts/verify-status-truth.ts`.

Kedjan C → D → import → drain kan lyckas och ändå lämna källan som `fail` i
statusfilen. Det är inte kosmetiskt: felräknaren (`consecutiveFailures`)
stiger vid varje sådan körning, och vid 5 begravs källan — en källa som
fungerar försvinner ur pipelinen. Det hände med riksarkivet: C-gaten skrev
`fail` (plain HTML gav 0 events), D-gaten lyckades sedan (24 events, 25
credits), men ingen skrev bort `fail`. Källan stod som död medan den hade
24 events i databasen.

**Två åtgärder:**

1. **D-gaten skriver statusen vid lyckad extrahering** (`runD-scrapingbee.ts`).
   Bara success skrivs — ett misslyckande i D skrivs redan av C-gaten, och att
   skriva det igen skulle räkna ett fel två gånger och accelerera
   auto-quarantän. Statusfelet får ALDRIG kasta: köerna skrivs efter loopen,
   så ett throw skulle slänga bort resultatet av en körning som redan
   bränt credits.
2. **Render-override även på de tre "orphan"-vägarna** i C-gaten.
   `preferredPath: 'render'` betyder "plain HTML gav 0 events, render är den
   bekräftade vägen" — men tre sökvägar (ORPHAN-FIX, IMP-001-FIX, RECOVERY)
   hårdkodade `postTestC-manual-review` och bypassade regeln. Nu går de
   genom `resolveOrphanRoute()`, som är ren och testad (4 tester, varav två
   negativa kontroller).

**Räckvidd för mätningen:** bara levande källor i scope (`sources/<id>.jsonl`
finns och `city = Stockholm`). Burkade/retirerade källor och källor utanför
Stockholm räknas inte — de hör till andra beslut.

- [x] ST1: varje källa som D-gaten lyckades med står som success med nollställd felräknare och utan lastError
  CHECK: node scripts/verify-fixes.mjs st1
  EXPECT: /st1: kontrollerade=\d+ statusfel=0 rensade_filer=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f2261fb4fea73f6f04f0aec1831e1659f68d49eef8fc661ed5600311c4d824b6; exit=0; EXPECT=matched; output-sha256=8db8fc1ae87bebd0a3bfba00883c53d001e199840717106db4b0ad64b4b3ff1d; output-bytes=55; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] ST2: negativ kontroll — en muterad kopia av statusfilen där felräknaren inte nollställs upptäcks (utan denna gate bevisar ST1 ingenting)
  CHECK: node scripts/verify-fixes.mjs st2
  EXPECT: /st2: negativ kontroll avvikelser=\d+ .* pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=bf43ba98378d6a60dc668f773c370290cdfe3273d66228eace92183f2751ace8; exit=0; EXPECT=matched; output-sha256=b2c2204c7e9f25b2028925306cf3b90919706940ddae2c348a6ac3d15387fa4c; output-bytes=60; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] ST3: render-override gäller på alla tre orphan-vägarna — 4 enhetstester inkl. två negativa kontroller
  CHECK: npx vitest run 02-Ingestion/C-htmlGate/run-dynamic-pool.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b6b66f30d0edb8b4b3f4be81c171e8e567fa760ade36d78e904c367e9817fef7; exit=0; EXPECT=matched; output-sha256=ad330bfd8708b4a2799f0bd81411f018ad57e3667b2148b9f57eba545d45ed1d; output-bytes=212; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

## Månadsnamnens ordgräns (2026-10-24) — extraktorn

Scope: `02-Ingestion/F-eventExtraction/universal-extractor.ts`,
`02-Ingestion/F-eventExtraction/universal-extractor-month-boundary.test.ts`,
`scripts/verify-month-boundary.mjs`.

Månadsnamnen avslutades med `\b` (word boundary). Men en siffra ÄR ett
word-tecken — mellan "oktober" och "1" finns ingen word boundary. Därför
matchade aldrig "29 oktober185" (berwaldhallen.se: månad + pris utan
mellanrum). Kortet fick ingen datum-signal, C3 expanderade upp till en granne
med ett annat datum ("6 november"), och 21 av 22 konserter i listan fick
samma feldatum.

Filen innehåll redan den rätta regeln (`SWE_MONTH_NOT_LETTER` = "efter
månadsnamnet får inte komma en bokstav"), men tre regexar använde ändå `\b`:
`SWE_MONTH_FOLLOWS_LOOKAHEAD`, `SWE_DATE_NO_YEAR_RX`, `SWE_EXPLICIT_DATE_RX`.

**Bevis för General (Generalization Protection Rule):** samma felform mätte på
fem orelaterade domäner — berwaldhallen.se (22 rader), fotografiska.se (16),
konserthuset-2 (1), nationalmuseum.se (1), rival.se (1). Det är HTML-kontraktet
"månadsnamn följt av en siffra", inte ett sitedomänproblem.

**Mätning före/efter (samma oracle, `scripts/measure-aggregate-cards.mjs`):**
63 → 81 extraherade events över 14 domäner. De 18 nya raderna är riktiga
konserter som före fixen inte alls fick datum.

Negativa kontroller: "12 maria" får inte ge 12 mars, "Julia" får inte ge
juli, och ett datumintervall med år ("12-14 januari 2027") ska överleva
regeln oförändrat.

- [x] MB1: enhetstesterna för månadsnamnens ordgräns passerar (6 tester, varav tre negativa kontroller)
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/universal-extractor-month-boundary.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=f3785bfaf4fb2ccb6e6299e4fd007f04b653552acca685885deb403b202bad7c; exit=0; EXPECT=matched; output-sha256=da0a5686efdf596f0841cbccfac2e001325c54352cb916aa15adecc152957711; output-bytes=211; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] MB2: hela extraktorns testsvit är grönt — ingen regression av ordgränsfixen
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=13e312eff1060baa85c43d0b1abacf3cf3fc3096f20d14a3eaa75aff92efb95d; exit=0; EXPECT=matched; output-sha256=b62ac68df5bf4fd493754f2822553964db60fa04cc77c780db380a8c168d30e4; output-bytes=218; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] MB3: LEVDAG — berwaldhallen.se hämtas och extraktorn ger konserten 29 oktober (före fixen: 6 november)
  CHECK: npx tsx scripts/verify-month-boundary.mjs
  EXPECT: /mb: live berwaldhallen streetstar=\d{4}-10-29 .*kontroller=3 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=551d6e77327e5039065fd906c0d7c070931c1f43367fb658f5e231b1c7ce49af; exit=0; EXPECT=matched; output-sha256=edd20e2f8f70785c9a84e41d326bba1b07e8700d9e8edf75c965fb08e28128fe; output-bytes=262; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] MB4: negativ kontroll — samma kontroller mot en muterad före-fix-kopia ska FAIL:a (annars bevisar MB3 ingenting)
  CHECK: npx tsx scripts/verify-month-boundary.mjs --negative-control
  EXPECT: /mb-negativkontroll: före-fix-kopia FAIL:ar som väntat \(\d+ kontroller\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=6e8f21c3995f85f9052400191a33c8ab84adadcbdf657440b2661a8f7eff8f48; exit=0; EXPECT=matched; output-sha256=11e4ea6eb997b2eff0043aab943e80244fc51eb8a91a82e38f4ad92c638b9581; output-bytes=178; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

## Underrubrik är inte evenemangets namn (2026-10-25) — extraktorn

Scope: `02-Ingestion/F-eventExtraction/titleClassTokens.ts` (ny),
`02-Ingestion/F-eventExtraction/titleClassTokens.test.ts` (ny),
`02-Ingestion/F-eventExtraction/universal-extractor-subtitle.test.ts` (ny),
`02-Ingestion/F-eventExtraction/universal-extractor.ts`,
`scripts/verify-subtitle-titles.mjs` (ny).

Extraktorn hittar titlar med `[class*="title"]`. CSS-väljaren matchar varje
klass som INNEHÅLLER strängen "title" — och det gör även "subtitle",
"subTitle", "hero-video__subtitle". På berwaldhallen.se:

    <h3 class="Blurb__heading">
      <a href="…/streetstardanceschoolchallenge2026-14-16-ar">
        Streetstar Dance School Challenge 2026
        <span class="Blurb__subtitle"> — Next Generation 14–16 år</span>
      </a>
    </h3>

Underrubriken matchade `[class*="title"]` och låg först i dokumentordningen —
så 20 av berwaldhallens rader fick underrubriken som evenemangets namn i
stället för konsertens titel.

**Bevis för General (Generalization Protection Rule):** samma klassmönster
fanns på sju ORELATERADE domäner, uppmätta 2026-10-25 över 112 aktiva
källor — berwaldhallen.se ("Blurb__subtitle"), berwaldhallen-tixly.se
("Blurb__subtitle"), concerts50.com ("subtitle2"),
nobelprizemuseum.se ("hero-video__subtitle"), modernamuseet.se
("post-carousel__item-subtitle"), scalateatern.se ("subtitle") och svt.se
("RelatedLinkTeaser__subTitle___yWnZC"). Det är HTML-kontraktet "klassnamn
med 'subtitle' betyder underrubrik", inte ett sitedomänproblem.

Negativa kontroller: riktiga rubrik-klasser ("title", "event-title",
"post__title", "Blurb__heading") ska INTE påverkas, och en rubrik utan
klass ska alltid räknas.

**Mätning före/efter (samma oracle, `scripts/measure-aggregate-cards.mjs`):**
berwaldhallen titel-bitar 20 → 0. Övriga domäner: ingen försämring.

- [x] SB1: enhetstesterna för rubrik-klasser passerar (8 tester, varav fyra negativa kontroller)
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/titleClassTokens.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2262f642b3416441d0ea6c6683e7e20802e40889279390f7b1b108dc975e51ed; exit=0; EXPECT=matched; output-sha256=cf2d4acc22972b68fcc32caef86cc2c785c930563a4c39092170c3777d3b2324; output-bytes=208; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SB2: extraktorns testvit är grönt — underrubrik-fixen ger ingen regression
  CHECK: npx vitest run 02-Ingestion/F-eventExtraction/
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=13e312eff1060baa85c43d0b1abacf3cf3fc3096f20d14a3eaa75aff92efb95d; exit=0; EXPECT=matched; output-sha256=3590fc43d13e5d144363400d846f4fac3d0b57ae94cff93b9b24545748c1b6d5; output-bytes=218; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SB3: LEVDAG — berwaldhallen.se hämtas live och ingen rad får en underrubrik som titel (före fixen: 20 rader)
  CHECK: npx tsx scripts/verify-subtitle-titles.mjs
  EXPECT: /sb: live berwaldhallen rader=\d+ .*kontroller=3 pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=4f2366c4e3f785ce065723ecb86598329a33d1f75210721d987ed0c05eeba136; exit=0; EXPECT=matched; output-sha256=66e38e45414d50dac3b9e300100f88a83f1b10d146d27640389303bca5510193; output-bytes=350; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] SB4: negativ kontroll — samma kontroller mot en muterad före-fix-kopia ska FAIL:a (annars bevisar SB3 ingenting)
  CHECK: npx tsx scripts/verify-subtitle-titles.mjs --negative-control
  EXPECT: /sb-negativkontroll: före-fix-kopia FAIL:ar som väntat \(\d+ kontroller\) pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa2cfb3c7b2073587a10f142ee67c6fee38872fa51abc341b37e64ecede4f5b2; exit=0; EXPECT=matched; output-sha256=d5e8c8261677fcac081a9dfd8ab606877be9d1023f45d58159243f1d88d71531; output-bytes=304; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

## Censusen ska skilja "fastnar" från "verifierat tom" (2026-10-25)

Scope: `scripts/census-zero-sources.mjs`, `scripts/lib/sourceAudit.mjs` (ny),
`scripts/lib/sourceAudit.test.ts` (ny),
`scripts/verify-census-classification.mjs` (ny).

Censusen listar aktiva källor med noll rader i databasen. Två helt olika
saker hamnade i samma lista: källor som FASTNAT (borde ge events) och
källor som är utredda och medvetet tomma (parken publicerar inget, lokalen
har ingen eventyta, säsongen är slut). Operatören kunde inte se vilken
kategori en rad tillhörde — listan var "3 nollrader" utan mer.

En källa räknas som verifierat tom bara om metadata har ALLA tre fälten:
`audit_status` (vad som gjordes), `audit_reason` (varför 0 är riktigt) och
`audit_evidence` (mätningen som stöder det). Ett tomt fält räknas som
saknat — annars kan en halvfärdig audit dölja en trasig källa.

Utdata: `fastnar` och `verifierat tomma` i skilda hinkar, `--file` skriver
bara fastnar-listan (med `--file-include-verified` för alla), och
`--sources-dir` pekar om registret som läses så att negativa kontroller
kan köras mot en kopia utan att röra produktion.

Mätning 2026-10-25: 130 aktiva källor, 127 med rader, 3 nollrader —
0 fastnar, 3 verifierat tomma.

- [x] CC1: enhetstesterna för audit-klassificeringen passerar (9 tester, varav sex negativa kontroller)
  CHECK: npx vitest run scripts/lib/sourceAudit.test.ts
  EXPECT: /Tests\s+\d+ passed/
  EVIDENCE: automatic-evidence=v1; definition-sha256=e7940929bdb770d7ed91966e22ed9071a9d9ba89da73cd5dbba9c215f0b53a01; exit=0; EXPECT=matched; output-sha256=5c333dc0ff34b4833b061bddad9a449b02fd4590096f4c21c5beb309ff39c549; output-bytes=207; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries

- [x] CC2: censusen skiljer fastnar från verifierat tomma — live mot databasen, plus negativ kontroll med auditen borttagen ur en kopia
  CHECK: node scripts/verify-census-classification.mjs
  EXPECT: /cc: censusen skiljer fastnar från verifierat tomma — fastnar=\d+ verifierat=\d+ nollrad=\d+ kontroller=\d+ pass/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a748b974737c044066388cb7f51fb9028b02f947a190bd2bda24f7cf94192bd5; exit=0; EXPECT=matched; output-sha256=b291ee80b6059cb2689fad74c48023fed2ad03bfd48cb8d3f8b6afa1768acb22; output-bytes=504; shell=/bin/sh; cwd=/Users/claudgashi/EventPulse; path=29325ef63737/16 entries
