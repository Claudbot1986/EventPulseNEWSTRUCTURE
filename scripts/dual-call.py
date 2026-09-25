#!/usr/bin/env python3
"""
dual-call.py — Two-LLM cross-validation via OpenRouter.

Calls two models on the same content + question, returns both analyses, flags conflicts.

Usage:
  python3 scripts/dual-call.py \
      --content "PR description text..." \
      --question "Is this PR description clear and complete?" \
      --model-a anthropic/claude-3-5-sonnet \
      --model-b google/gemini-2.0-flash

Logs to docs/operations/jev-decisions.md with mode=dual.
Increments trial counter in docs/operations/jev-trial-state.json.
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
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL_A = "minimax/minimax-m3"
DEFAULT_MODEL_B = "google/gemini-3.5-flash"
TIMEOUT = 30


def load_env():
    env = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def call_chat(api_key, model, messages, max_tokens=1024):
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens}
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_dual(api_key, model_a, model_b, content, question):
    system = "You are a careful reviewer. Answer the question about the content provided in 2-4 sentences."
    user = f"Content:\n{content}\n\nQuestion:\n{question}"
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]

    out_a = out_b = None
    err_a = err_b = None
    try:
        r = call_chat(api_key, model_a, msgs)
        out_a = r["choices"][0]["message"]["content"].strip()
    except Exception as e:
        err_a = f"{type(e).__name__}: {e}"

    try:
        r = call_chat(api_key, model_b, msgs)
        out_b = r["choices"][0]["message"]["content"].strip()
    except Exception as e:
        err_b = f"{type(e).__name__}: {e}"

    return out_a, out_b, err_a, err_b


def log_to_ledger(content, result):
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not LEDGER_PATH.exists():
        LEDGER_PATH.write_text(
            "# Jev Decision Ledger\n\n"
            "Append-only log. Format: "
            "`YYYY-MM-DD HH:MM | mode | type | state | answer | action`.\n\n"
            "---\n\n",
            encoding="utf-8",
        )
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    state_short = content if len(content) <= 140 else content[:137] + "..."
    answer_short = json.dumps(result, ensure_ascii=False)[:240]
    line = f"{ts} | dual | score | {state_short} | {answer_short} | \n"
    with LEDGER_PATH.open("a", encoding="utf-8") as f:
        f.write(line)


def increment_trial_counter():
    if not TRIAL_STATE_PATH.exists():
        return
    try:
        state = json.loads(TRIAL_STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    state.setdefault("calls_by_mode", {})
    state["calls_by_mode"]["dual"] = state["calls_by_mode"].get("dual", 0) + 1
    state["calls_total"] = state.get("calls_total", 0) + 1
    tmp = TRIAL_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, TRIAL_STATE_PATH)


def main():
    p = argparse.ArgumentParser(description="Dual-LLM cross-validation via OpenRouter")
    p.add_argument("--content", required=True)
    p.add_argument("--question", required=True)
    p.add_argument("--model-a", default=DEFAULT_MODEL_A)
    p.add_argument("--model-b", default=DEFAULT_MODEL_B)
    p.add_argument("--no-log", action="store_true")
    args = p.parse_args()

    env = load_env()
    api_key = env.get("OPENROUTER_API_KEY", "")
    if not api_key or api_key.startswith("_PLACEHOLDER_"):
        print("ERROR: OPENROUTER_API_KEY not configured", file=sys.stderr)
        sys.exit(2)

    print(f"[dual] calling {args.model_a} + {args.model_b}...", file=sys.stderr)
    out_a, out_b, err_a, err_b = call_dual(api_key, args.model_a, args.model_b, args.content, args.question)

    if err_a or err_b:
        print(f"  errors: a={err_a} b={err_b}", file=sys.stderr)

    exact_match = (out_a is not None and out_b is not None
                   and out_a.strip().lower() == out_b.strip().lower())

    result = {
        "model_a": args.model_a, "out_a": out_a, "err_a": err_a,
        "model_b": args.model_b, "out_b": out_b, "err_b": err_b,
        "exact_match": exact_match,
    }

    if not args.no_log:
        log_to_ledger(args.content, result)
        increment_trial_counter()

    print(f"\n=== DUAL OUTPUT ({args.model_a}) ===\n{out_a or '[ERROR]'}\n")
    print(f"=== DUAL OUTPUT ({args.model_b}) ===\n{out_b or '[ERROR]'}\n")
    print(f"=== EXACT MATCH: {'YES' if exact_match else 'NO'} ===")


if __name__ == "__main__":
    main()
