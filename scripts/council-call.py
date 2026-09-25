#!/usr/bin/env python3
"""
council-call.py — Karpathy-style 3-stage LLM council via OpenRouter.

Stage 1: Fan-out. N models answer the same question independently.
Stage 2: Blind peer review. Each model ranks the others' answers (identities hidden).
Stage 3: Chairman synthesis. A designated model reads all answers + rankings and writes final.

Usage:
  python3 scripts/council-call.py \
      --question "Should we add Postgres read-replicas to EventPulse?" \
      --state "Current ingest latency p95 is 800ms. Read traffic is 5x write." \
      --models openai/gpt-4o-mini,anthropic/claude-3-5-sonnet,google/gemini-2.0-flash \
      --chairman openai/gpt-4o-mini

Logs to docs/operations/jev-decisions.md with mode=council.
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
DEFAULT_COUNCIL = ["openai/gpt-4o-mini", "minimax/minimax-m3", "google/gemini-3.5-flash"]
DEFAULT_CHAIRMAN = "openai/gpt-4o-mini"
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


def stage1_answers(api_key, models, state, question):
    system = "You are a thoughtful assistant. Answer concisely with your best reasoning (3-5 sentences)."
    user = f"Context:\n{state}\n\nQuestion:\n{question}"
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    out = {}
    for m in models:
        try:
            r = call_chat(api_key, m, msgs)
            out[m] = r["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as e:
            out[m] = f"[HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:120]}]"
        except Exception as e:
            out[m] = f"[ERROR: {type(e).__name__}: {e}]"
    return out


def stage2_rankings(api_key, models, question, answers):
    labels = list(answers.keys())
    labeled = "\n\n".join(
        f"=== Response {chr(65 + i)} ===\n{ans}" for i, ans in enumerate(answers.values())
    )
    system = (
        "You are a fair judge. Rank the responses from best to worst. "
        "Output ONLY a numbered list of response labels (A, B, C, ...) "
        "with one short sentence of reasoning each. Do not identify authors."
    )
    user = f"Question:\n{question}\n\nResponses (anonymized):\n{labeled}"
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    rankings = {}
    for m in models:
        try:
            r = call_chat(api_key, m, msgs)
            rankings[m] = r["choices"][0]["message"]["content"].strip()
        except Exception as e:
            rankings[m] = f"[ERROR: {type(e).__name__}: {e}]"
    return rankings


def stage3_chairman(api_key, chairman, question, answers, rankings):
    label_letters = ["A", "B", "C", "D", "E"]
    parts = []
    for i, ans in enumerate(answers.values()):
        parts.append(f"=== Original answer {label_letters[i]} ===\n{ans}")
    for i, rk in enumerate(rankings.values()):
        parts.append(f"=== Peer ranking by {label_letters[i]} ===\n{rk}")
    system = (
        "You are a chairman synthesizing a council. Read all original answers and "
        "all peer rankings, then produce a single concise final answer (5-8 sentences) "
        "that incorporates the strongest points and addresses the disagreements."
    )
    user = f"Question:\n{question}\n\n" + "\n\n".join(parts)
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    r = call_chat(api_key, chairman, msgs, max_tokens=1500)
    return r["choices"][0]["message"]["content"].strip()


def log_to_ledger(state, result):
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
    state_short = state if len(state) <= 140 else state[:137] + "..."
    answer_short = json.dumps(result, ensure_ascii=False)[:240]
    line = f"{ts} | council | choice | {state_short} | {answer_short} | \n"
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
    state["calls_by_mode"]["council"] = state["calls_by_mode"].get("council", 0) + 1
    state["calls_total"] = state.get("calls_total", 0) + 1
    tmp = TRIAL_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, TRIAL_STATE_PATH)


def main():
    p = argparse.ArgumentParser(description="Karpathy-style LLM council via OpenRouter")
    p.add_argument("--question", required=True)
    p.add_argument("--state", default="")
    p.add_argument("--models", default=",".join(DEFAULT_COUNCIL))
    p.add_argument("--chairman", default=DEFAULT_CHAIRMAN)
    p.add_argument("--no-log", action="store_true")
    args = p.parse_args()

    env = load_env()
    api_key = env.get("OPENROUTER_API_KEY", "")
    if not api_key or api_key.startswith("_PLACEHOLDER_"):
        print("ERROR: OPENROUTER_API_KEY not configured", file=sys.stderr)
        sys.exit(2)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if len(models) < 2:
        print("ERROR: need at least 2 models for a council", file=sys.stderr)
        sys.exit(2)

    print(f"[council stage 1] fan-out to {len(models)} models...", file=sys.stderr)
    answers = stage1_answers(api_key, models, args.state, args.question)
    for m, a in answers.items():
        preview = a[:100].replace("\n", " ")
        print(f"  [{m}] {preview}{'...' if len(a) > 100 else ''}", file=sys.stderr)

    print("[council stage 2] blind peer review...", file=sys.stderr)
    rankings = stage2_rankings(api_key, models, args.question, answers)
    for m, r in rankings.items():
        preview = r[:100].replace("\n", " ")
        print(f"  [{m}] {preview}{'...' if len(r) > 100 else ''}", file=sys.stderr)

    print(f"[council stage 3] chairman ({args.chairman}) synthesizes...", file=sys.stderr)
    final = stage3_chairman(api_key, args.chairman, args.question, answers, rankings)

    result = {"answers": answers, "rankings": rankings, "final": final}

    if not args.no_log:
        log_to_ledger(args.state, result)
        increment_trial_counter()

    print("\n=== COUNCIL FINAL ANSWER ===\n")
    print(final)
    print("\n=== (full data logged to ledger) ===")


if __name__ == "__main__":
    main()
