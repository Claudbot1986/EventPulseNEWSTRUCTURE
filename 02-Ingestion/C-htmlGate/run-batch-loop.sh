#!/bin/bash
# run-batch-loop.sh — Sekventiell körning tills postB-preC är tomt
# 123-autonomous-loop-v3 tar hand om allt: cleanup + batch-körning

cd "$(dirname "$0")/../.."

echo "=========================================="
echo "  123 Batch Loop — start $(date)"
echo "=========================================="

LOOP=0
while true; do
    LOOP=$((LOOP+1))
    
    QUEUE_SIZE=$(wc -l < runtime/postB-preC-queue.jsonl 2>/dev/null || echo "0")
    
    echo ""
    echo "--- Loop $LOOP | postB-preC: $QUEUE_SIZE sources ---"
    
    if [ "$QUEUE_SIZE" -eq 0 ]; then
        echo "✓ Kö tom! Avslutar."
        break
    fi
    
    # Kör 123 (cleanup görs internt)
    npx tsx 02-Ingestion/C-htmlGate/123-autonomous-loop-v3.ts
    
    # Liten paus
    sleep 3
done

echo ""
echo "=========================================="
echo "  KLART! $LOOP loopar, $(date)"
echo "=========================================="
