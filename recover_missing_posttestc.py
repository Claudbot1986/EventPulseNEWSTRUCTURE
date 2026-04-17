#!/usr/bin/env python3
"""
recover_missing_posttestc.py - FIXED VERSION

Recovery script: Sources that exited the C-pool (allExitedIds) but were never
written to any postTestC-*.jsonl file get written to the CORRECT queue based on
their exit decision.

Run: python3 recover_missing_posttestc.py
"""

import json
import os
import re
from pathlib import Path

RUNTIME_DIR = Path(__file__).parent / "runtime"
REPORTS_DIR = Path(__file__).parent / "02-Ingestion" / "C-htmlGate" / "reports"

QUEUE_FILES = {
    "postTestC-UI": RUNTIME_DIR / "postTestC-UI.jsonl",
    "postTestC-A": RUNTIME_DIR / "postTestC-A.jsonl",
    "postTestC-B": RUNTIME_DIR / "postTestC-B.jsonl",
    "postTestC-D": RUNTIME_DIR / "postTestC-D.jsonl",
    "postTestC-manual-review": RUNTIME_DIR / "postTestC-manual-review.jsonl",
}


def get_posttestc_sources():
    sources = set()
    for f in RUNTIME_DIR.iterdir():
        if f.name.startswith("postTestC") and f.suffix == ".jsonl":
            for line in f.read_text().splitlines():
                if line.strip():
                    try:
                        entry = json.loads(line)
                        sources.add(entry.get("sourceId", ""))
                    except:
                        pass
    return sources


def get_all_exited_with_decision():
    """
    Get all unique sources that have exited any batch pool,
    along with their exit decision and result info.
    """
    sources = {}  # sourceId -> {batchId, decision, rounds, result}
    
    for batch_dir in REPORTS_DIR.iterdir():
        if not re.match(r'^batch-\d+$', batch_dir.name):
            continue
        state_file = batch_dir / "pool-state.json"
        if not state_file.exists():
            continue
            
        try:
            with open(state_file) as f:
                state = json.load(f)
            
            for ex in state.get("exited", []):
                if not isinstance(ex, dict):
                    continue
                source = ex.get("source", {})
                if not source:
                    continue
                    
                sid = source.get("sourceId")
                if not sid:
                    continue
                
                decision = ex.get("decision", "")
                result = ex.get("result") or {}
                
                # Only take first exit (not re-exits)
                if sid not in sources:
                    sources[sid] = {
                        "batchId": batch_dir.name,
                        "decision": decision,
                        "rounds": source.get("roundsParticipated", 0),
                        "winningStage": result.get("winningStage", "C4-AI"),
                        "outcomeType": result.get("outcomeType", "fail"),
                        "routeSuggestion": result.get("routeSuggestion", "manual-review"),
                        "evidence": result.get("evidence", ""),
                    }
        except Exception as e:
            print(f"  Warning: Could not read {state_file}: {e}")
    
    return sources


def get_queue_for_decision(decision: str) -> Path:
    """Map decision string to queue file path."""
    queue_path = QUEUE_FILES.get(decision)
    if not queue_path:
        queue_path = QUEUE_FILES["postTestC-manual-review"]
    return queue_path


def main():
    print("=== Recovery: Missing postTestC entries ===\n")
    
    in_posttestc = get_posttestc_sources()
    print(f"Sources already in postTestC files: {len(in_posttestc)}")
    
    all_exited = get_all_exited_with_decision()
    print(f"Total unique sources that exited pools: {len(all_exited)}")
    
    # Find missing
    missing = []
    for source_id, info in all_exited.items():
        if source_id not in in_posttestc:
            missing.append((source_id, info))
    
    print(f"\nSources EXITED pool but NOT in postTestC: {len(missing)}")
    
    if not missing:
        print("Nothing to recover. Exiting.")
        return
    
    # Group by decision
    from collections import Counter
    decision_counts = Counter(info["decision"] for _, info in missing)
    print("\nBy decision:")
    for decision, cnt in decision_counts.most_common():
        print(f"  {decision}: {cnt}")
    
    # Show first 10
    print("\nFirst 10 missing:")
    for sid, info in missing[:10]:
        print(f"  {sid} -> {info['decision']} (batch: {info['batchId']})")
    
    # Write to appropriate queues
    print(f"\nWriting {len(missing)} entries to appropriate queues...")
    
    written = Counter()
    for sid, info in missing:
        queue_path = get_queue_for_decision(info["decision"])
        
        entry = {
            "sourceId": sid,
            "queueName": info["decision"],
            "queuedAt": "2026-04-17T00:00:00.000Z",
            "priority": 1,
            "attempt": 1,
            "queueReason": info.get("evidence", f"[RECOVERY] Exited pool ({info['batchId']}) but never written to postTestC"),
            "workerNotes": f"RECOVERY: Found in allExitedIds of {info['batchId']} with decision={info['decision']}",
            "winningStage": info.get("winningStage", "C4-AI"),
            "outcomeType": info.get("outcomeType", "fail"),
            "routeSuggestion": info.get("routeSuggestion", "manual-review"),
            "roundNumber": info.get("rounds", 0),
            "roundsParticipated": info.get("rounds", 0),
        }
        
        with open(queue_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
        
        written[info["decision"]] += 1
    
    print("\n=== Recovery complete ===")
    print("Written to queues:")
    for decision, cnt in written.most_common():
        print(f"  {decision}: {cnt}")
    print(f"Total: {sum(written.values())}")


if __name__ == "__main__":
    main()
