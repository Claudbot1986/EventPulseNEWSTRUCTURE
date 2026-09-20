#!/usr/bin/env python3
"""Målar terminalfliken grön medan Claude jobbar, återställer när Claude är klar.

Flera parallella sessioner stör inte varandra:
- Haken identifierar sin egen flik via tty:t för Claude-processen som startade
  den (ppid). Målning och återställning träffar bara fliken med matchande tty,
  aldrig "selected tab of front window" — en bakgrundssession kan därför inte
  måla om fliken du tittar på.
- Originalfärgen sparas i en egen state-fil per tty ($TMPDIR/claude-term-bg-<tty>.json).
  Sessioner skriver aldrig över varandras sparade färg.
- capture skriver aldrig över en befintlig state-fil, så ett överlevande
  grönt läge aldrig kan sparas som "original".
- Kan tty:t inte matchas någon flik (tmux, annan terminalapp) faller haken
  tillbaka på gamla beteendet: selected tab of front window.

Lägen (första argumentet):
  capture  - spara flikens nuvarande färg (SessionStart)
  green    - måla fliken grön (UserPromptSubmit m.fl.), sparar originalfärgen
             först om state-filen saknas
  reset    - återställ flikens sparade färg (Stop och SessionEnd), raderar
             state-filen

Färger är AppleScript-RGB 0-65535. Fel ignoreras tyst - färgtricket får aldrig
störa en session. Avslutar alltid med status 0.

Självläkning + migration från gamla versionen:
- Gamla versionen delade EN state-fil (claude-term-bg.json) mellan alla
  sessioner, så en session kunde spara det gröna som "original". Om en färg som
  ska sparas eller återställas är exakt GREEN behandlas den som korrupt och
  ersätts med Terminal-appens standardbakgrund (background color of default
  settings).
- Om per-tty-filen saknas men den gamla delade filen finns används den vid
  reset (så redan pågående sessioner återställs korrekt vid första Stop).
"""
import json
import os
import re
import subprocess
import sys
import tempfile

GREEN = "0, 45000, 0"  # klar grön, ca #00AD00

GET_BY_TTY = """
on run argv
  set target to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          return background color of t
        end if
      end repeat
    end repeat
  end tell
  return ""
end run
"""

SET_BY_TTY_TEMPLATE = """
on run argv
  set target to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set background color of t to {%s}
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "miss"
end run
"""

GET_SELECTED = 'tell application "Terminal" to get background color of selected tab of front window'
SET_SELECTED_TEMPLATE = 'tell application "Terminal" to set background color of selected tab of front window to {%s}'
GET_DEFAULT = 'tell application "Terminal" to get background color of default settings'


def run_osa(script, *args):
    try:
        return subprocess.run(
            ["osascript", "-e", script, *args],
            capture_output=True, text=True, timeout=10)
    except Exception:
        return None


def session_tty():
    """TTY:t för Claude-processen som startade haken, t.ex. /dev/ttys005.

    Haken är ett barn till Claude-REPL:et, så ppid:s tty pekar på rätt flik
    även när flera sessioner är igång samtidigt. Returnerar None om tty:t inte
    kan avläsas (då faller resten av haken tillbaka på främsta fliken).
    """
    try:
        r = subprocess.run(["ps", "-o", "tty=", "-p", str(os.getppid())],
                           capture_output=True, text=True, timeout=5)
        name = r.stdout.strip()
        if re.fullmatch(r"tty[a-z]*[0-9]+", name):
            return "/dev/" + name
        if re.fullmatch(r"[a-z]*[0-9]+", name):
            return "/dev/tty" + name
    except Exception:
        pass
    return None


def tty_core(tty):
    """/dev/ttys005 -> s005. Används som filnamnsnyckel."""
    if not tty:
        return "unknown"
    m = re.search(r"tty([a-z]*[0-9]+)$", tty)
    return m.group(1) if m else "unknown"


def store_path(core):
    return os.path.join(tempfile.gettempdir(), "claude-term-bg-" + core + ".json")


def get_color(tty):
    if tty:
        r = run_osa(GET_BY_TTY, tty)
        if r is not None and r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip().strip("{}")
    r = run_osa(GET_SELECTED)
    if r is not None and r.returncode == 0:
        return r.stdout.strip().strip("{}")
    return None


def set_color(color, tty):
    if not re.fullmatch(r"[\d, ]+", color):
        return
    if tty:
        r = run_osa(SET_BY_TTY_TEMPLATE % color, tty)
        if r is not None and r.stdout.strip() == "ok":
            return
    run_osa(SET_SELECTED_TEMPLATE % color)


def norm(color):
    return (color or "").replace(" ", "")


def default_color():
    r = run_osa(GET_DEFAULT)
    if r is not None and r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip().strip("{}")
    return None


def sane(color):
    """Grönt som "original" betyder att gamla delade state-filen smittat -
    byt mot Terminals standardbakgrund istället för att låsa sig fast i grönt."""
    if color and norm(color) == norm(GREEN):
        return default_color()
    return color


def capture(tty, core):
    path = store_path(core)
    if os.path.exists(path):
        return  # skriv aldrig över - gamla originalet är säkrare än ett gissat nytt
    color = sane(get_color(tty))
    if color:
        with open(path, "w") as f:
            json.dump({"color": color}, f)


def green(tty, core):
    path = store_path(core)
    if not os.path.exists(path):
        capture(tty, core)
    set_color(GREEN, tty)


def reset(tty, core):
    path = store_path(core)
    if os.path.exists(path):
        try:
            with open(path) as f:
                color = json.load(f).get("color")
        finally:
            os.remove(path)
    else:
        # Migration: ny per-tty-fil saknas men gamla delade filen kan finnas
        # kvar från sessioner som startade före uppgraderingen.
        legacy = os.path.join(tempfile.gettempdir(), "claude-term-bg.json")
        if not os.path.exists(legacy):
            return
        try:
            with open(legacy) as f:
                color = json.load(f).get("color")
        finally:
            os.remove(legacy)
    color = sane(color)
    if color:
        set_color(color, tty)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        tty = session_tty()
        core = tty_core(tty)
        if mode == "capture":
            capture(tty, core)
        elif mode == "green":
            green(tty, core)
        elif mode == "reset":
            reset(tty, core)
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
