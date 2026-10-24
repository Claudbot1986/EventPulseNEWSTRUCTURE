# Gates: ingestion + discovery six-fixes (2026-10-21)

OWNS: scripts/ingestion-cron.ts, scripts/verify-fixes.mjs, 09-ScrapingSupervisor/runDaily.ts, 02-Ingestion/A-directAPI-networkGate/runA.ts, 02-Ingestion/C-htmlGate/run-dynamic-pool.ts, 02-Ingestion/tools/runRecorder.ts, 05-Supabase/migrations/20261021-*, 07-Discovery/src/sourceTesting/realToolRunner.ts, 03-Queue/importToEventPulse.ts, 02-Ingestion/F-eventExtraction/universal-extractor.ts, 04-Normalizer/normalizer.ts, scripts/verify-extractor-object-fields.mjs, scripts/verify-import-pipeline.mjs

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
