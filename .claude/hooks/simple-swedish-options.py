#!/usr/bin/env python3
"""
UserPromptSubmit-hook: validerar att Claude:s senaste svar håller
"alternativ på människospråk"-regeln.

Varför:
   Användaren har förbjudit att Claude:s alternativ (i planer,
   AskUserQuestion, etc.) innehåller teknisk jargong utan inline-
   förklaring. Fragmenterade/komplicerade planer skapar merarbete.

Utlöses av:
   Claude Code UserPromptSubmit-eventet (alltid).

Inputs:
   JSON på stdin, shape:
     {"conversation": [{"role": "assistant", "content": "..."}]}

Beteende:
   - Parsar Claude:s senaste svar.
   - Hittar ALLA numrerade listor (1./2./3. eller A/B/C) som ser ut som
     val — inte bara under rubriken "Alternativ:". Detta fångar de fall
     där Claude smyger in kontext (spår-referenser, kodrader, helper-
     namn) INUTI själva valen.
   - Träff → exit 2 + stderr-varning. Claude får chans att skriva om.
   - Ingen träff → exit 0.

Begränsningar:
   - Hook:en fångar bara de värsta fallen. Användaren bör ändå läsa
     igenom och ge feedback om något är för krångligt.
"""

import json
import re
import sys

# Mönster som tyder på teknisk jargong i alternativ. Vi kräver att
# jargongordet INTE är följt av en inline-förklaring i parantes eller
# efterföljande mening som förklarar vad det betyder i klartext.
JARGON_PATTERNS = [
    # Git-kommandon och PR-flöden
    r"\bcheckout\s+-b\b",
    r"\bswitch\s+-c\b",
    r"\bgit\s+branch\b",
    r"\bpush\s+--set-upstream\b",
    r"\bgh\s+pr\s+create\b",
    # Arkitektur-/runtime-termer
    r"\bCORS-preflight\b",
    r"\bRLS-policy\b",
    r"\bmonorepo-root\b",
    r"\bconditional\s+exports\b",
    r"\btransform-worker\b",
    r"\bIInteropWrapper\b",
    r"\bGoTrueClient-instans\b",
    r"\bESM/CJS-resolver\b",
    # Spår-referenser (typ "Spår 1 / Spår 2 / Spår 3") — ska inte blandas
    # in i själva val-listan. Tillåts om inline-förklarat i samma rad.
    r"\bSpår\s+\d+\b",
    # Kodrads-citat (t.ex. "runC-one-time-only.ts lines 1353-1407" eller
    # "app.js:138"). Dessa hör hemma EFTER att användaren valt, inte i
    # valen i sig.
    r"\b\w[\w./-]+\.ts:?\d{2,}\b",
    r"\b\w[\w./-]+\.tsx:?\d{2,}\b",
    r"\b\w[\w./-]+\.js:?\d{2,}\b",
    r"\b\w[\w./-]+\.py:?\d{2,}\b",
    r"\blines?\s+\d{2,}\s*[-–]\s*\d{2,}\b",
]

# Alternativ-sektioner kan heta:
#   "Alternativ:", "Välj:", "Options:", "Val:", "Plan-alternativ:"
ALTERNATIV_MARKERS = re.compile(
    r"(Alternativ|Välj|Options|Val|Plan-alternativ)\s*:",
    re.IGNORECASE,
)

# Inline-förklaring i parantes (3+ tecken) — då tillåter vi jargongen.
INLINE_PARENS = re.compile(r"\([^()]{3,}\)")

# Detekterar en numrerad lista: "1. text", "2) text", "A) text", "A. text".
# Kräver minst 2 rader i rad (annars är det inte en lista utan en enstaka
# punkt i en mening).
NUMBERED_ITEM = re.compile(r"^\s*(?:\d+[.)]|[A-Z][.)])\s+\S")

# Spår-referenser på egna rader, t.ex. "Spår 1: dedup i helper." — dessa
# är ofta dolda val-listor där varje spår är ett alternativ.
SPAR_ITEM = re.compile(r"^\s*Spår\s+\d+\s*[:.)]\s+\S", re.IGNORECASE)

# Frågefraser som signalerar att svaret innehåller val. Ofta står frågan
# precis innan listan — vi snappar listan som kommer direkt efter.
QUESTION_PHRASES = re.compile(
    r"(vilken|vilket|vilka|vad\s+föredrar|ska\s+vi|kör\s+vi|välj|"
    r"var\s+(ska|ska\s+du|lägga|sättas)|hur\s+vill\s+du|"
    r"what|which|do\s+you\s+want)",
    re.IGNORECASE,
)


def find_alternativ_section(text: str) -> str:
    """Hittar texten efter sista 'Alternativ:'-markern, fram till nästa
    rubrik med ### eller liknande."""
    matches = list(ALTERNATIV_MARKERS.finditer(text))
    if not matches:
        return ""

    start = matches[-1].end()
    # Sluta vid nästa rubrik eller styckeslut.
    rest = text[start:]
    end_match = re.search(r"\n\s*(?:#{1,6}\s|\n\n|$)", rest)
    if end_match:
        rest = rest[: end_match.start()]
    return rest.strip()


def find_numbered_lists(text: str) -> str:
    """Hittar ALLA numrerade listor i texten — inte bara under
    'Alternativ:'-rubrik. Returnerar sammanlagd text från alla sådana
    listor som har ≥ 2 numrerade rader. Detta fångar fall där Claude
    smyger in spår-referenser eller kod-citat INUTI en val-lista.

    Undantar listor som uppenbart inte är val, t.ex.:
      - "steg 1. / steg 2." i en instruktion
      - koordinater eller nummer i tabellceller

    Vi kräver också att det finns en frågefras i de 200 tecknen INNAN
    listan börjar — annars är det inte ett val, det är bara en lista.

    Specialfall: om texten innehåller både Spår-rader OCH numrerade
    rader OCH en frågefras, behandla hela texten som en val-sektion
    (Claude har ofta "Spår 1/2/3" + "Vilken policy?" + "1./2./3."-val
    i samma svar — spår-listan och val-listan hör ihop).
    """
    lines = text.splitlines()
    blocks: list[str] = []

    i = 0
    while i < len(lines):
        if NUMBERED_ITEM.match(lines[i]) or SPAR_ITEM.match(lines[i]):
            # Samla ihop listan från denna punkt.
            block_start = i
            j = i
            while j < len(lines) and (
                NUMBERED_ITEM.match(lines[j])
                or SPAR_ITEM.match(lines[j])
                or lines[j].strip() == ""
            ):
                j += 1
            block = "\n".join(lines[block_start:j]).strip()
            # Kräv minst 2 numrerade rader för att det ska räknas som lista.
            n_items = sum(
                1 for ln in block.splitlines()
                if NUMBERED_ITEM.match(ln) or SPAR_ITEM.match(ln)
            )
            if n_items >= 2:
                # Kräv frågefras i de 200 tecknen innan blocket.
                prefix_start = max(0, sum(len(l) + 1 for l in lines[:block_start]) - 200)
                prefix = text[prefix_start:sum(len(l) + 1 for l in lines[:block_start])]
                if QUESTION_PHRASES.search(prefix):
                    blocks.append(block)
            i = j
        else:
            i += 1

    # Specialfall: spår-rader + numrerade rader + fråga i samma text →
    # granska hela texten som en val-sektion.
    has_spar = any(SPAR_ITEM.match(ln) for ln in lines)
    has_numbered = any(NUMBERED_ITEM.match(ln) for ln in lines)
    if has_spar and has_numbered and QUESTION_PHRASES.search(text):
        blocks.append(text)

    return "\n\n".join(blocks)


def is_jargon_unexplained(line: str) -> bool:
    """Returnerar True om raden innehåller jargong utan inline-förklaring."""
    # Om raden redan har inline-förklaring i parantes, tillåt jargongen.
    if INLINE_PARENS.search(line):
        return False
    for pattern in JARGON_PATTERNS:
        if re.search(pattern, line):
            return True
    return False


def main() -> int:
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError):
        return 0

    conversation = data.get("conversation", [])
    if not conversation:
        return 0

    # Hitta senaste assistant-meddelandet.
    last_assistant = None
    for msg in reversed(conversation):
        if msg.get("role") == "assistant":
            last_assistant = msg.get("content", "")
            break

    if not last_assistant:
        return 0

    # Slå ihop sektioner från båda detektorerna: uttrycklig 'Alternativ:'-rubrik
    # OCH fråge-inducerade numrerade listor.
    explicit = find_alternativ_section(last_assistant)
    implicit = find_numbered_lists(last_assistant)
    sections = [s for s in (explicit, implicit) if s]
    if not sections:
        return 0

    # Kolla varje rad i alla funna sektioner. Vi granskar ALLA rader
    # (inte bara de som ser ut som alternativ) — kodrads-citat och
    # helper-namn kan ligga inbakade i löpande text i en val-sektion.
    bad_lines = []
    for section in sections:
        for line in section.splitlines():
            line = line.strip()
            if not line:
                continue
            if is_jargon_unexplained(line):
                bad_lines.append(line[:120])

    if bad_lines:
        sys.stderr.write(
            "BLOCKERAD: alternativ i svaret innehåller teknisk jargong utan "
            "inline-förklaring. Skriv om enligt 'Alternativ på människospråk'-"
            "regeln.\n"
            f"  Problemrader: {bad_lines}\n"
            "  Tillåtna mönster: 'A) gör X (kort förklaring)' eller liknande.\n"
            "  Spår-referenser, kodrads-citat och helper-namn hör hemma EFTER "
            "att användaren valt, inte i själva val-listan.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())