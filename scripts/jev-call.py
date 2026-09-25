#!/usr/bin/env python3
"""
jev-call.py — call OpenRouter's Jev decision model.

Usage:
  # noul (yes/no probability, 0..1)
  python3 scripts/jev-call.py --type noul \
      --state "Adding a 50MB npm dependency for a single import" \
      --question "Is this dependency justified?"

  # choice (pick one of N alternatives, criteria = "label:description,...")
  python3 scripts/jev-call.py --type choice \
      --state "Choosing a CSS approach for a small React Native screen" \
      --question "Which CSS approach fits best?" \
      --criteria "tailwind:utility-first css-modules:scoped styled-components:runtime"

  # score (1..N, criteria = "level:label,..."; criteria must be ARRAY-shaped)
  python3 scripts/jev-call.py --type score \
      --state "Plan to add a feature flag system with rollout toggles" \
      --question "How good is this plan? 1=poor 10=excellent" \
      --criteria "1:POOR,5:OK,10:EXCELLENT"

Always logs to docs/operations/jev-decisions.md unless --no-log.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"
LEDGER_PATH = REPO_ROOT / "docs" / "operations" / "jev-decisions.md"
TRIAL_STATE_PATH = REPO_ROOT / "docs" / "operations" / "jev-trial-state.json"
OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_MODEL = "typesafe/jev-1.13"
TIMEOUT_SECONDS = 10


def load_env():
    """Parse .env without dotenv. Only reads OPENROUTER_API_KEY."""
    env = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def parse_criteria(raw, qtype):
    """Parse --criteria into the schema Jev expects per question type.

    noul / choice: object {label: description}
    score: array [[level, description], ...]  (OpenRouter rejects object form)
    """
    if not raw:
        return None
    pairs = [p.strip() for p in raw.split(",") if p.strip()]
    items = []
    for p in pairs:
        if ":" in p:
            k, v = p.split(":", 1)
            items.append((k.strip(), v.strip()))
        else:
            items.append((p, p))
    if qtype == "score":
        return [[k, v] for k, v in items]
    return {k: v for k, v in items}


def call_jev(api_key, model, state, questions):
    payload = {"model": model, "state": state, "questions": questions}
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def log_to_ledger(qtype, state, answer, action):
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not LEDGER_PATH.exists():
        LEDGER_PATH.write_text(
            "# Jev Decision Ledger\n\n"
            "Append-only log. Format: "
            "`YYYY-MM-DD HH:MM | type | state (≤140c) | answer | action`.\n\n"
            "---\n\n",
            encoding="utf-8",
        )
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    state_short = state if len(state) <= 140 else state[:137] + "..."
    answer_short = json.dumps(answer, ensure_ascii=False)[:240]
    action_safe = (action or "").replace("\n", " ").replace("|", "/")
    line = f"{ts} | advisor | {qtype} | {state_short} | {answer_short} | {action_safe}\n"
    with LEDGER_PATH.open("a", encoding="utf-8") as f:
        f.write(line)


def increment_trial_counter():
    if not TRIAL_STATE_PATH.exists():
        return
    try:
        st = json.loads(TRIAL_STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    st.setdefault("calls_by_mode", {})
    st["calls_by_mode"]["advisor"] = st["calls_by_mode"].get("advisor", 0) + 1
    st["calls_total"] = st.get("calls_total", 0) + 1
    tmp = TRIAL_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, TRIAL_STATE_PATH)


def format_response(result, qtype):
    answers = result.get("answers", {})
    if not answers:
        return json.dumps(result, indent=2, ensure_ascii=False)
    name, ans = next(iter(answers.items()))
    if qtype == "noul":
        n = ans.get("noul")
        return f"Jev ({name}) = {n:.3f}" if isinstance(n, (int, float)) else f"Jev ({name}) = {n}"
    if qtype == "choice":
        probs = ans.get("probabilities", {}) or {}
        sorted_probs = sorted(probs.items(), key=lambda kv: -kv[1])
        winner = ans.get("choice") or (sorted_probs[0][0] if sorted_probs else "?")
        conf = ans.get("confidence", "?")
        probs_str = ", ".join(f"{k}={v:.2f}" for k, v in sorted_probs)
        return f"Jev väljer: {winner} (confidence={conf}). Alla: {probs_str}"
    if qtype == "score":
        s = ans.get("score")
        legend = ans.get("legend", {})
        conf = ans.get("confidence", "?")
        return f"Jev scorer: {s} (confidence={conf}, legend={legend})"
    return json.dumps(result, indent=2, ensure_ascii=False)


def main():
    p = argparse.ArgumentParser(description="Call Jev via OpenRouter")
    p.add_argument("--type", required=True, choices=["noul", "choice", "score"])
    p.add_argument("--state", required=True)
    p.add_argument("--question", required=True)
    p.add_argument("--name", default="decision")
    p.add_argument("--criteria")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--action", default="")
    p.add_argument("--no-log", action="store_true")
    args = p.parse_args()

    env = load_env()
    api_key = env.get("OPENROUTER_API_KEY", "")
    if not api_key or api_key.startswith("_PLACEHOLDER_"):
        print("ERROR: OPENROUTER_API_KEY not configured in .env", file=sys.stderr)
        sys.exit(2)

    criteria = parse_criteria(args.criteria, args.type)
    question = {"type": args.type, "instructions": args.question}
    if criteria is not None:
        question["criteria"] = criteria
    questions = {args.name: question}

    try:
        result = call_jev(api_key, args.model, args.state, questions)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR: HTTP {e.code} from OpenRouter: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: network: {e}", file=sys.stderr)
        sys.exit(1)

    if not args.no_log:
        log_to_ledger(args.type, args.state, result.get("answers", {}), args.action)
        increment_trial_counter()

    print(format_response(result, args.type))


if __name__ == "__main__":
    main()
