# Autonomous Execution Loop

Det här dokumentet beskriver hur EventPulse körs autonomt över tid — utan
att du behöver sitta och skriva "fortsätt" varje gång.

## Vad det är

Ett tunt supervisor-skikt utanför Claude Code som:

1. Startar en `claude --print /resume`-session.
2. Låter den jobba tills den avslutar med en commit, tills budgeten
   tar slut, eller tills den hänger.
3. Startar en ny session som läser vault-state och fortsätter.
4. Loggar varje iteration och synkar vault via vault-sync.

Målet: **kunna lämna datorn i timmar och komma tillbaka till ett
projekt som är ett antal commits längre fram.**

## Begränsningar vi ärliga om

- Claude Code-sessioner är bundna av context window (~200k tokens)
  och API rate limits. Vi kan inte göra en session "oändlig".
- Lösningen är att **kedja sessioner**, inte att göra en session
  evig. Varje session gör ett meningsfullt enhetsarbete (typiskt:
  en commit). State bärs vidare i vault + git.
- launchd / bash-wrappern har inga magiska krafter — den startar bara
  `claude --print /resume` igen när föregående dog.

## Tre ingångar

### 1. Foreground (engångs, manuell start)

```bash
scripts/autonomous-loop.sh
```

Kör i terminalen. Stoppa med Ctrl-C. Använd denna om du vill se vad
som händer eller vill stanna efter en specifik iteration.

### 2. Supervised (launchd, persistent)

```bash
scripts/install-autonomous-loop.sh
```

Installerar som macOS LaunchAgent. Startar vid boot, överlever
loggar ut, startar om vid krasch.

- Jobbningslabel: `com.eventpulse.autonomous`
- Plist: `~/Library/LaunchAgents/com.eventpulse.autonomous.plist`
- Loggar: `runtime/autonomous-loop/`
- Supervisera: `launchctl list | grep com.eventpulse.autonomous`

Stäng av permanent:

```bash
launchctl unload ~/Library/LaunchAgents/com.eventpulse.autonomous.plist
rm ~/Library/LaunchAgents/com.eventpulse.autonomous.plist
```

### 3. Hämta status / stoppa

```bash
scripts/autonomous-loop.sh --check   # visa state + pid + sista loggraden
scripts/autonomous-loop.sh --stop    # mjukt stopp via STOP-flagga
```

## Säkerhetskappslar (override via env)

| Variabel              | Default | Betydelse                                       |
|-----------------------|---------|-------------------------------------------------|
| `MAX_RESTARTS`        | 1000    | Max antal sessioner innan wrappern slutar       |
| `MAX_TOTAL_HOURS`     | 24      | Max wall-clock-tid innan stopp                  |
| `MAX_BUDGET_PER_ITER` | 5       | USD per `claude --print`-anrop                  |
| `ITERATION_TIMEOUT_MIN` | 30    | Hård kill om en session hänger                  |
| `RESTART_DELAY`       | 3       | Sekunder mellan iterationer                     |
| `LOG_DIR`             | runtime/autonomous-loop | Där loggar + state hamnar            |

Exempel — kortare, billigare körning:

```bash
MAX_TOTAL_HOURS=2 MAX_BUDGET_PER_ITER=2 ITERATION_TIMEOUT_MIN=15 \
  scripts/autonomous-loop.sh
```

## Vad överlever en omstart

| Vad              | Var                                                  | Format          |
|------------------|------------------------------------------------------|-----------------|
| Uppgiftskö       | `00-Vault/.../23-Active-Task-Queue.md`               | Markdown        |
| Nuvarande state  | `runtime/autonomous-loop/state.json`                 | JSON            |
| Wrapper PID      | `runtime/autonomous-loop/wrapper.pid`                | PID             |
| Per-iter-loggar  | `runtime/autonomous-loop/iter-N.json` + `iter-N.err` | one per iter    |
| launchd-övervakning | `~/Library/Logs/com.eventpulse.autonomous*.log`    | macOS log stream|

Ingenting bärs i process-minne mellan sessioner. Allt läses från disk
i början av varje `/resume`.

## Vad INTE överlever (ännu)

- Live-redigering av strategiska vault-filer (North Star, P1-P5)
  utan user approval — skyddat av lead-agent-rollen.
- En pågående mid-task som inte committats — den avbryts vid
  timeout, nästa session läser queue + git för att förstå vad som
  hände.
- API rate limits — wrappern respekterar dessa men kan inte
  gissa hur länge en cooldown varar.

## Hur recovery fungerar

När en ny session startar (via `/resume` eller fristående):

1. Läser `00-Execution-Index.md` (recovery-landningssida).
2. Följer ordningen i den: North Star → Current State → Active Task
   Queue → Current Task → Active Priorities → Next Steps → Blockers
   → Decision Log → Discovered Work.
3. `git log` + `git status` ankarpunkt i implementation-sanning.
4. Plockar första `pending` P0/P1/P2/P3, utför, committar.

Ingen "load conversation history" behövs.

## /resume-kommandot

Använd `/resume` (eller `/start` första gången) i Claude Code för att
göra samma recovery-sekvens interaktivt. Definierat i
`.claude/commands/resume.md`.

## Felsökning

| Symptom                              | Trolig orsak                               | Åtgärd                                |
|--------------------------------------|--------------------------------------------|---------------------------------------|
| Wrapper slutar direkt                | Wrapper redan kör (PID-fil kvar)           | `kill` gamla PID, ta bort `$PID_FILE`  |
| launchd säger "service not found"    | launchctl har inte laddat plisten          | `launchctl load $PLIST_DST`            |
| varje iteration time-out:ar          | `ITERATION_TIMEOUT_MIN` för liten          | höj env eller låt tasken bli mindre    |
| vault uppdateras inte mellan iters   | vault-sync körs inte i iter                | kontrollera iter-N.json för VAULT-SYNC |
| session säger "context full" ofta    | varje iter bär hela vault read i context   | minska vault read eller splitta tasks |

## Test scenarios (från bygg-uppdraget)

| Scenario                         | Förväntat beteende                                   |
|----------------------------------|------------------------------------------------------|
| Fresh session                    | Recovery-sequence läser vault → plockar task → gör jobb |
| Context loss mitt i task         | Task markeras `in_progress`, next session fortsätter |
| Agent completion (work subagent) | Lead inspekterar diff → verifierar → committar       |
| Strategy conflict                | Lead stannar, frågar user via AskUserQuestion        |
| Interrupted task (ingen commit)  | Next session ser `in_progress` i queue → tar upp    |

## Vägen framåt

Denna loop är medvetet tunn. Nästa naturliga steg:

1. **Pre-emptive compaction** — kör `/compact` innan context tar
   slut, undviker brutala klipp mitt i arbetet.
2. **Auto-vault-sync in i varje iter** istället för manuell
   rekonsiliation i slutet.
3. **Multi-machine**: samma loop på en VPS, inte bara Mac.
4. **Failure injection tests**: verifiera att recovery faktiskt
   klarar alla 5 scenarierna ovan, inte bara antar det.

Byggs i små, verifierade steg. Inte spekulativt.
