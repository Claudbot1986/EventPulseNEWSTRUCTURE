#!/bin/bash
#
# scripts/backup-gold.sh — Skapar "guld"-snapshot av EventPulse vid en specifik tag.
#
# Användning:
#   bash scripts/backup-gold.sh                          # använder v1.0-pipeline-guld (default)
#   bash scripts/backup-gold.sh v1.1-pipeline-guld       # custom tag
#   bash scripts/backup-gold.sh --list                   # lista befintliga snapshots
#
# Vad scriptet gör:
#   1. Skapar ~/EventPulse-GOLD-SNAPSHOTS/<datum>-<tag>/
#   2. Klona repot vid tag (snabb: --shared för hardlinks)
#   3. Rensar node_modules, .DS_Store, lokala loggar
#   4. Kopierar .env till env-original/ med chmod 600
#   5. Genererar migration-log.md + README.md
#   6. Verifierar att snapshot är komplett
#
# Säkerhet:
#   - .env är LOKAL, aldrig pushas till GitHub
#   - .env får mode 600 (endast ägaren kan läsa)
#   - Snapshot är på samma disk som repot — skyddar INTE mot disk-krasch
#   - För full säkerhet: kopiera snapshot-mappen till extern disk / Time Machine
#
# Skapad 2026-09-11 i samband med v1.0-pipeline-guld.

set -euo pipefail

REPO="/Users/claudgashi/EventPulse"
BACKUP_ROOT="$HOME/EventPulse-GOLD-SNAPSHOTS"

# ── Hjälpkommandon ────────────────────────────────────────────────────────

if [ "${1:-}" = "--list" ] || [ "${1:-}" = "-l" ]; then
  echo "Befintliga snapshots i $BACKUP_ROOT:"
  ls -la "$BACKUP_ROOT" 2>/dev/null | tail -n +2 | awk '{printf "  %-40s  %s\n", $9, $5}'
  exit 0
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Användning: $0 [tag-namn]"
  echo "  --list, -l   Lista befintliga snapshots"
  echo "  --help, -h   Visa denna hjälp"
  echo ""
  echo "Default tag: v1.0-pipeline-guld"
  echo "Snapshot-mapp: $BACKUP_ROOT/<datum>-<tag>/"
  exit 0
fi

# ── Argument ──────────────────────────────────────────────────────────────

TAG="${1:-v1.0-pipeline-guld}"
TIMESTAMP=$(date +%Y-%m-%d)
SNAPSHOT_DIR="$BACKUP_ROOT/$TIMESTAMP-$TAG"

# Kontrollera att tag finns
if ! git -C "$REPO" rev-parse "$TAG" >/dev/null 2>&1; then
  echo "FEL: Tag '$TAG' finns inte i repot."
  echo "Tillgängliga tags:"
  git -C "$REPO" tag -l
  exit 1
fi

# ── Förberedelser ─────────────────────────────────────────────────────────

echo "[backup-gold] === EventPipeline Guld-Snapshot ==="
echo "[backup-gold] Repo:    $REPO"
echo "[backup-gold] Tag:     $TAG"
echo "[backup-gold] Dest:    $SNAPSHOT_DIR"

# Kontrollera att snapshot-mappen inte redan finns
if [ -d "$SNAPSHOT_DIR" ]; then
  echo "FEL: Snapshot-mappen finns redan: $SNAPSHOT_DIR"
  echo "Ta bort den först eller välj annan tag/datum."
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR/repo" "$SNAPSHOT_DIR/env-original"
echo "[backup-gold] Skapade mappstruktur"

# ── 1. Klona repot vid tag ───────────────────────────────────────────────

echo "[backup-gold] Steg 1/5: Klona repot vid tag $TAG ..."
if ! git clone --shared --branch "$TAG" "$REPO" "$SNAPSHOT_DIR/repo" 2>&1 | tail -3; then
  echo "FEL: git clone misslyckades"
  exit 1
fi

# Verifiera att rätt commit hamnade i klonan
CLONE_HEAD=$(git -C "$SNAPSHOT_DIR/repo" rev-parse HEAD)
EXPECTED_HEAD=$(git -C "$REPO" rev-parse "$TAG")
if [ "$CLONE_HEAD" != "$EXPECTED_HEAD" ]; then
  echo "FEL: Klonans HEAD ($CLONE_HEAD) matchar inte tag ($EXPECTED_HEAD)"
  exit 1
fi
echo "[backup-gold]   ✓ Klonan vid rätt commit: ${CLONE_HEAD:0:8}"

# ── 2. Rensa lokala artefakter ───────────────────────────────────────────

echo "[backup-gold] Steg 2/5: Rensar artefakter ..."
rm -rf "$SNAPSHOT_DIR/repo/node_modules"
find "$SNAPSHOT_DIR/repo" -name ".DS_Store" -delete 2>/dev/null || true
# Ta bort lokala loggar men behåll post*-jsonl (state för pipeline)
find "$SNAPSHOT_DIR/repo/runtime" -name "*.log" -delete 2>/dev/null || true
rm -f "$SNAPSHOT_DIR/repo/runtime/ingestion-cron.status.json"
echo "[backup-gold]   ✓ Borttaget: node_modules, .DS_Store, *.log"

# ── 3. Kopiera .env ──────────────────────────────────────────────────────

echo "[backup-gold] Steg 3/5: Kopierar .env (säkerhet: chmod 600) ..."
if [ ! -f "$REPO/.env" ]; then
  echo "FEL: $REPO/.env finns inte. Kan inte säkerhetskopiera hemligheter."
  exit 1
fi
cp "$REPO/.env" "$SNAPSHOT_DIR/env-original/.env"
chmod 600 "$SNAPSHOT_DIR/env-original/.env"
chmod 600 "$SNAPSHOT_DIR/repo/.env" 2>/dev/null || true
ENV_SIZE=$(wc -c < "$SNAPSHOT_DIR/env-original/.env" | tr -d ' ')
echo "[backup-gold]   ✓ .env kopierad ($ENV_SIZE bytes, mode 600)"

# ── 4. Generera migration-log och README ─────────────────────────────────

echo "[backup-gold] Steg 4/5: Genererar dokumentation ..."

cat > "$SNAPSHOT_DIR/migration-log.md" <<'MIGRATION_EOF'
# Deployerade migrationer vid snapshot

Följande migrationer har körts mot Supabase via Management API.

MIGRATION_EOF

# Lista alla migrationer deployerade efter senaste större schema-brytning
for migration in "$REPO/05-Supabase/migrations/2026"*.sql; do
  if [ -f "$migration" ]; then
    filename=$(basename "$migration")
    echo "" >> "$SNAPSHOT_DIR/migration-log.md"
    echo "## $filename" >> "$SNAPSHOT_DIR/migration-log.md"
    echo "" >> "$SNAPSHOT_DIR/migration-log.md"
    echo '```sql' >> "$SNAPSHOT_DIR/migration-log.md"
    head -20 "$migration" >> "$SNAPSHOT_DIR/migration-log.md"
    echo '```' >> "$SNAPSHOT_DIR/migration-log.md"
  fi
done

cat > "$SNAPSHOT_DIR/README.md" <<README_EOF
# Pipeline Snapshot — $TIMESTAMP

**Tag:** \`$TAG\`
**Commit:** \`${CLONE_HEAD:0:8}\`
**Skapad:** $TIMESTAMP av $(whoami)

## Innehåll

- \`repo/\` — Komplett kopia av repot vid tag $TAG (node_modules exkluderat)
- \`env-original/.env\` — Säkerhetskopia av .env (mode 600)
- \`migration-log.md\` — Lista över migrationer i repot
- \`sharp-*-evidence.log\` — Körningsbevis (om sharp körts)

## Återställning

\`\`\`bash
# 1. Klona från snapshot om repot är förstört
git clone $SNAPSHOT_DIR/repo /Users/claudgashi/EventPulse

# 2. Eller växla existerande repo till denna tag
cd /Users/claudgashi/EventPulse
git fetch --tags
git checkout $TAG

# 3. Återställ .env
cp $SNAPSHOT_DIR/env-original/.env /Users/claudgashi/EventPulse/.env
chmod 600 /Users/claudgashi/EventPulse/.env

# 4. Verifiera
cd /Users/claudgashi/EventPulse
npm install
bash scripts/cron/runSmoke.sh
\`\`\`

## Storlek

Repo: $(du -sh "$SNAPSHOT_DIR/repo" | cut -f1)
Total: $(du -sh "$SNAPSHOT_DIR" | cut -f1)
README_EOF

echo "[backup-gold]   ✓ migration-log.md + README.md genererade"

# ── 5. Verifiering ───────────────────────────────────────────────────────

echo "[backup-gold] Steg 5/5: Verifierar ..."

# Kontrollera att .env finns
if [ ! -f "$SNAPSHOT_DIR/env-original/.env" ]; then
  echo "FEL: .env inte kopierad"
  exit 1
fi

# Kontrollera att kritisk fil finns
if [ ! -f "$SNAPSHOT_DIR/repo/scripts/ingestion-cron.ts" ]; then
  echo "FEL: ingestion-cron.ts saknas i snapshot"
  exit 1
fi

# Kontrollera migrationer
if [ ! -f "$SNAPSHOT_DIR/repo/05-Supabase/migrations/20260911-0002-source-candidates.sql" ]; then
  echo "VARNING: source_candidates-migration saknas (kan vara OK om tag är äldre)"
fi

# ── Sammanfattning ───────────────────────────────────────────────────────

TOTAL_SIZE=$(du -sh "$SNAPSHOT_DIR" | cut -f1)
REPO_SIZE=$(du -sh "$SNAPSHOT_DIR/repo" | cut -f1)

echo ""
echo "[backup-gold] ═══════════════════════════════════════"
echo "[backup-gold] ✓ KLAR"
echo "[backup-gold] Snapshot: $SNAPSHOT_DIR"
echo "[backup-gold] Repo:     $REPO_SIZE"
echo "[backup-gold] Total:    $TOTAL_SIZE"
echo "[backup-gold] ═══════════════════════════════════════"
echo ""
echo "Verifiera med:"
echo "  ls -la $SNAPSHOT_DIR"
echo "  bash scripts/backup-gold.sh --list"