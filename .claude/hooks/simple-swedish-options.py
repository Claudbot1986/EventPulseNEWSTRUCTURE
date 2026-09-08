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
   - Om det finns en sektion som ser ut som "Alternativ:" följd av en
     numrerad lista med val, kontrollerar varje val mot jargonglistan.
   - Träff → exit 2 + stderr-varning. Claude får chans att skriva om.
   - Ingen träff → exit 0.

Begränsningar:
   - Hook:en fångar bara de värsta fallen (hård Git-/arkitektur-jargong
     i svars-svar utan förklarande parentes). Användaren bör ändå läsa
     igenom och ge feedback om något är för krångligt.
"""

import json
import re
import sys

# Mönster som tyder på teknisk jargong i alternativ. Vi kräver att
# jargongordet INTE är följt av en inline-förklaring i parantes eller
# efterföljande mening som förklarar vad det betyder i klartext.
JARGON_PATTERNS = [
    r"\bcheckout\s+-b\b",
    r"\bswitch\s+-c\b",
    r"\bgit\s+branch\b",
    r"\bpush\s+--set-upstream\b",
    r"\bgh\s+pr\s+create\b",
    r"\bCORS-preflight\b",
    r"\bRLS-policy\b",
    r"\bmonorepo-root\b",
    r"\bconditional\s+exports\b",
    r"\btransform-worker\b",
    r"\bIInteropWrapper\b",
    r"\bGoTrueClient-instans\b",
    r"\bESM/CJS-resolver\b",
]

# Alternativ-sektioner kan heta:
#   "Alternativ:", "Välj:", "Options:", "Val:", "Plan-alternativ:"
ALTERNATIV_MARKERS = re.compile(
    r"(Alternativ|Välj|Options|Val|Plan-alternativ)\s*:",
    re.IGNORECASE,
)

# Inline-förklaring i parantes (3+ tecken) — då tillåter vi jargongen.
INLINE_PARENS = re.compile(r"\([^()]{3,}\)")


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

    section = find_alternativ_section(last_assistant)
    if not section:
        return 0

    # Kolla varje rad i alternativ-sektionen.
    bad_lines = []
    for line in section.splitlines():
        line = line.strip()
        if not line:
            continue
        # Bara rader som ser ut som alternativ (nummer, punkt, eller A:/B:).
        if re.match(r"^[•*\dA-Z][\.\):]", line) or re.match(r"^- ", line):
            if is_jargon_unexplained(line):
                bad_lines.append(line[:120])

    if bad_lines:
        sys.stderr.write(
            "BLOCKERAD: alternativ i svaret innehåller teknisk jargong utan "
            "inline-förklaring. Skriv om enligt 'Alternativ på människospråk'-"
            "regeln.\n"
            f"  Problemrader: {bad_lines}\n"
            "  Tillåtna mönster: 'A) gör X (kort förklaring)' eller liknande.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())