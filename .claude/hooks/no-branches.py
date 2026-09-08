#!/usr/bin/env python3
"""
PreToolUse-hook: blockerar branch-skapande / branch-byt / push / PR.

Varför:
   Användaren har uttryckligen förbjudit att Claude skapar, byter eller
   pushar branches i sina körningar. Fragmentering av arbetet i flera
   branches har skapat röra. Denna hook fångar Git-kommandon tidigt
   och exit:2 (block) om de matchar den blockerade listan.

Utlöses av:
   Claude Code PreToolUse-eventet (matcher: "Bash")

Inputs:
   JSON på stdin, shape:
     {"tool_name": "Bash", "tool_input": {"command": "git ..."}}

Beteende:
   - Exit 0 → tillåt kommandot (vanligare fallet)
   - Exit 2 → block + stderr-meddelande till Claude
   - Parsar INTE allowlistor — allt som matchar blockeras, alltid.
"""

import json
import re
import sys

# Kommandon som blockerar. Vi matchar hela orden, inte delsträngar,
# för att inte fånga saker som innehåller "branch" i en kommentar.
BLOCKED_PATTERNS = [
    r"\bgit\s+checkout\s+-b\b",          # skapa ny branch
    r"\bgit\s+checkout\s+--orphan\b",   # skapa orphan branch
    r"\bgit\s+switch\s+-c\b",           # skapa + byt (ny syntax)
    r"\bgit\s+switch\s+-C\b",           # skapa + byt (override)
    # git branch som skapar/ändrar/raderar:
    #   git branch <namn>          — skapa
    #   git branch -m <gammal> <ny> — rename
    #   git branch -d/-D <namn>    — ta bort
    #   git branch --move, --delete
    # Vi blockerar när namnet INTE börjar med en flagga (dvs read-only).
    r"\bgit\s+branch\s+(?!--show-current|-a|-r|-l|-v|--[a-z-]+(?:\s|$))\S",
    r"\bgit\s+branch\s+-m\b",
    r"\bgit\s+branch\s+-M\b",
    r"\bgit\s+branch\s+-d\b",
    r"\bgit\s+branch\s+-D\b",
    r"\bgit\s+branch\s+--move\b",
    r"\bgit\s+branch\s+--delete\b",
    r"\bgit\s+push\s+-u\b",             # första push (skapar upstream)
    r"\bgit\s+push\s+--set-upstream\b", # samma som -u
    r"\bgh\s+pr\s+create\b",            # öppna PR
    r"\bgh\s+repo\s+create\b",          # skapa nytt repo
]

# Tillåtna Git-kommandon (read-only + lokalt arbete som inte fragmenterar):
#   git status, git log, git diff, git add, git commit, git fetch,
#   git merge, git rebase, git pull, git stash, git tag, git remote -v,
#   git branch --show-current, git branch -a, etc.
# (Inga åtgärder behövs — vi blockerar bara det som står i listan ovan.)


def main() -> int:
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError):
        return 0  # Trasig input — tillåt

    tool_input = data.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return 0

    command = tool_input.get("command", "")
    if not isinstance(command, str):
        return 0

    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, command):
            # Skriv till stderr — Claude Code fångar det och stoppar
            # verktyget. Exit 2 = "block" i Claude Code PreToolUse.
            sys.stderr.write(
                "BLOCKERAD: användaren har förbjudit branch-skapande, "
                "branch-byt, och PR-öppning i Claude-körningar. "
                "Användaren bestämmer branching manuellt.\n"
                f"  Kommando: {command.strip()[:200]}\n"
                f"  Matchade: {pattern}\n"
                "Be användaren bekräfta om detta ska köras ändå.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())