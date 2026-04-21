#!/usr/bin/env python3
"""
Inbox Processor — Hybrid rule-based + AI fallback for Obsidian vault inbox.

Rules:
- Filename pattern matching → direct folder classification
- No match → AI classification (Ollama/MiniMax)
- Creates folders if they don't exist
- Moves files, doesn't copy

Cron: * * * * * (every minute)
"""

import os
import re
import sys
import json
import shutil
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

# === CONFIGURATION ===

VAULT_ROOT = Path("/Users/claudgashi/Desktop/MyVault/TomorGashi")
INBOX_PATH = VAULT_ROOT / "00-Inbox"
PROCESSED_PATH = VAULT_ROOT / "00-Inbox" / ".processed"  # Audit trail

# Folder mapping: keyword -> destination folder
RULES = {
    # Projects
    "projects": "01-Projects",
    "project": "01-Projects",
    "plan": "01-Projects",
    "scraping": "01-Projects",
    "eventpulse": "01-Projects",
    # Areas
    "area": "02-Areas",
    "domain": "02-Areas",
    # Reference
    "reference": "03-Reference",
    "docs": "03-Reference",
    "documentation": "03-Reference",
    "manual": "03-Reference",
    # People
    "people": "04-People",
    "person": "04-People",
    "contact": "04-People",
    # Ideas
    "idea": "05-Ideas",
    "brainstorm": "05-Ideas",
    "concept": "05-Ideas",
    # Systems
    "system": "06-Systems",
    "setup": "06-Systems",
    "config": "06-Systems",
    "automation": "06-Systems",
    # Daily
    "daily": "07-Daily",
    "review": "07-Daily",
    "log": "07-Daily",
    "journal": "07-Daily",
    # Archive
    "archive": "08-Archive",
    "arkiv": "08-Archive",
    "old": "08-Archive",
}

# AI settings
USE_AI_FALLBACK = True
AI_PROVIDER = "ollama"  # or "minimax"
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.2"

# Logging
LOG_PATH = VAULT_ROOT / "07-Daily" / "inbox-processor.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


# === CORE LOGIC ===

def get_file_age_minutes(path: Path) -> float:
    """Get file age in minutes."""
    stat = path.stat()
    mtime = stat.st_mtime
    now = datetime.now().timestamp()
    return (now - mtime) / 60


def apply_rules(filename: str) -> Optional[str]:
    """Apply filename-based rules to determine destination folder."""
    filename_lower = filename.lower()

    for keyword, folder in RULES.items():
        if keyword in filename_lower:
            log.info(f"Rule match: '{keyword}' in '{filename}' → {folder}")
            return folder

    return None


def ai_classify(content: str, filename: str) -> Optional[str]:
    """Use AI to classify a file based on its content."""
    if not USE_AI_FALLBACK:
        return None

    prompt = f"""Classify this file for an Obsidian vault.

Filename: {filename}

Content preview:
{content[:500]}

Choose the best folder from this list:
- 01-Projects (for project plans, specs, implementations)
- 02-Areas (for ongoing areas of focus)
- 03-Reference (for documentation, guides, references)
- 04-People (for person profiles, contacts)
- 05-Ideas (for ideas, concepts, brainstorms)
- 06-Systems (for system configs, automations, setups)
- 07-Daily (for daily notes, reviews, logs)
- 08-Archive (for old/archived material)

Reply with ONLY the folder name, nothing else. Example: 01-Projects"""

    try:
        import urllib.request
        import urllib.error

        payload = {
            "model": MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 50}
        }

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            OLLAMA_URL,
            data=data,
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            folder = result.get("response", "").strip()

            # Validate response
            valid_folders = list(RULES.values())
            if folder in valid_folders:
                log.info(f"AI classified: '{filename}' → {folder}")
                return folder
            else:
                log.warning(f"AI returned invalid folder: '{folder}'")
                return None

    except Exception as e:
        log.error(f"AI classification failed: {e}")
        return None


def ensure_folder_exists(folder_name: str) -> Path:
    """Ensure folder exists, create if not."""
    folder_path = VAULT_ROOT / folder_name
    folder_path.mkdir(exist_ok=True)
    return folder_path


def move_file(src_path: Path, dest_folder: str, filename: str) -> Path:
    """Move file to destination folder with conflict handling."""
    dest_path = ensure_folder_exists(dest_folder) / filename

    # Handle filename conflicts
    if dest_path.exists():
        # Add timestamp suffix
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        stem = Path(filename).stem
        ext = Path(filename).suffix
        dest_path = ensure_folder_exists(dest_folder) / f"{stem}_{timestamp}{ext}"
        log.warning(f"Filename conflict, renamed to: {dest_path.name}")

    shutil.move(str(src_path), str(dest_path))
    log.info(f"Moved: {src_path.name} → {dest_folder}/{dest_path.name}")
    return dest_path


def archive_processed(src_path: Path) -> None:
    """Archive the original file for audit trail."""
    PROCESSED_PATH.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stem = src_path.stem
    ext = src_path.suffix
    archive_name = f"{stem}_{timestamp}{ext}"
    shutil.copy2(str(src_path), str(PROCESSED_PATH / archive_name))


def process_inbox() -> dict:
    """Main processing loop."""
    stats = {"processed": 0, "skipped": 0, "errors": 0}

    if not INBOX_PATH.exists():
        log.error(f"Inbox not found: {INBOX_PATH}")
        return stats

    files = list(INBOX_PATH.glob("*.md"))
    if not files:
        log.debug("No files in inbox")
        return stats

    log.info(f"Found {len(files)} file(s) in inbox")

    for file_path in files:
        # Skip hidden and processed folders
        if file_path.name.startswith("."):
            continue

        # Skip files younger than 30 seconds (still being written)
        age = get_file_age_minutes(file_path)
        if age < 0.5:
            log.debug(f"Skipping (too new): {file_path.name}")
            stats["skipped"] += 1
            continue

        try:
            filename = file_path.name

            # Step 1: Apply rules
            dest_folder = apply_rules(filename)

            # Step 2: AI fallback if no rule matched
            if dest_folder is None:
                log.info(f"No rule match for '{filename}', trying AI...")
                content = file_path.read_text(encoding="utf-8")
                dest_folder = ai_classify(content, filename)

                if dest_folder is None:
                    # Default to 02-Areas if AI also fails
                    dest_folder = "02-Areas"
                    log.warning(f"AI failed, defaulting '{filename}' to {dest_folder}")

            # Step 3: Move file
            archive_processed(file_path)
            move_file(file_path, dest_folder, filename)
            stats["processed"] += 1

        except Exception as e:
            log.error(f"Error processing {file_path.name}: {e}")
            stats["errors"] += 1

    return stats


# === ENTRY POINT ===

if __name__ == "__main__":
    log.info("=" * 50)
    log.info("Inbox Processor started")
    stats = process_inbox()
    log.info(f"Done. Processed: {stats['processed']}, Skipped: {stats['skipped']}, Errors: {stats['errors']}")
    log.info("=" * 50)
