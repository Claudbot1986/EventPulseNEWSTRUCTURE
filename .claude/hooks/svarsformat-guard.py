#!/usr/bin/env python3
"""svarsformat-guard.py — Stop hook (projektsettings).

Enforcer for the CLAUDE.md rule "Svarsformat (permanent)" (user decision
2026-09-04, commit dc240a7): every response containing technical content
must end with a "På människospråk" section — including interim/status
updates.

How it works: the harness runs this script on every Stop event, passing
the session transcript path on stdin. The script inspects the LAST
assistant message that carries text. If that text is substantial (≥ 200
chars ≈ technical content, not pure conversation) and lacks the marker,
it exits 2 — the stop is blocked and the stderr reminder is fed back to
the assistant, which must then append the section.

Fail-open by design: any IO/parse problem exits 0. A formatting guard
must never brick a session. Exemptions per CLAUDE.md: short/purely
conversational replies (< 200 chars) and tool-only messages pass.
"""

import json
import sys

MIN_LEN = 200  # below this a reply is treated as pure conversation
MARKER = "På människospråk"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    transcript = payload.get("transcript_path")
    if not transcript or not isinstance(transcript, str):
        return 0

    try:
        with open(transcript, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except Exception:
        return 0

    # Last assistant message that actually carries text (skip tool-only).
    last_text = None
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message") or {}
        content = message.get("content")
        if not isinstance(content, list):
            continue
        texts = [
            c.get("text", "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        combined = "\n".join(t for t in texts if isinstance(t, str)).strip()
        if combined:
            last_text = combined
            break

    if last_text is None:
        return 0
    if len(last_text) < MIN_LEN:
        return 0
    if MARKER in last_text:
        return 0

    sys.stderr.write(
        "Svarsformat-regeln (CLAUDE.md): detta svar innehåller tekniskt innehåll "
        "men saknar avsnittet 'På människospråk' i slutet. Skriv avsnittet nu — "
        "en kort, enkel förklaring på svenska så att en icke-teknisk läsare "
        "förstår vad som gjordes och varför — och avsluta svaret igen."
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())