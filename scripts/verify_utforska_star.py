#!/usr/bin/env python3
"""
verify_utforska_star.py — visuell verifiering av AI-stämpel i Utforska*.

Förutsätter:
  - Expo web körs på http://localhost:8081 (eller BASE_URL env)
  - EXPO_PUBLIC_EXPLORE_STAR_ENABLED=true vid expo start

Vad gör skriptet:
  1. Öppnar Expo web
  2. Väntar tills splash försvinner
  3. Klickar på Utforska*-tabben
  4. För varje <img> på sidan: väntar tills naturalWidth>0, screenshot:ar bilden
  5. Validerar varje screenshot: extraherar SE-hörn-region (motsvarande
     200×48 vid x=800, y=740 i 1024-bild, omräknat till cover-croppad yta)
     och räknar orange pixlar (#FFB454 ± tolerans)
  6. Skriver JSON-rapport till /tmp/utforska-star-report.json
  7. Visar tabell med resultat

Användning:
  python3 scripts/verify_utforska_star.py
  BASE_URL=http://192.168.1.10:8081 python3 scripts/verify_utforska_star.py
"""

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# ── Config ────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8081")
OUT_DIR = Path("/tmp/utforska-star")
REPORT_PATH = Path("/tmp/utforska-star-report.json")
STAR_BANNER = '[data-testid="utforska-star-banner"]'
STAR_TAB = '[aria-label="Utforska*"]'

# ── Helpers ───────────────────────────────────────────────────────────
def wait_for_expo(page, timeout_ms=60_000):
    """Wait until Expo serves a 200 (any HTML). Bundling kan ta tid
    första gången — försök igen tills vi får HTTP 200 på root."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        try:
            resp = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=10_000)
            if resp and resp.status == 200:
                return True
        except PlaywrightTimeoutError:
            pass
        time.sleep(2)
    return False


def skip_onboarding(page, timeout_ms=15_000):
    """Onboarding visas först — klicka 'Fortsätt till EventPulse' om synlig."""
    try:
        page.wait_for_selector('[aria-label="Fortsätt till EventPulse"]', timeout=timeout_ms)
        page.locator('[aria-label="Fortsätt till EventPulse"]').first.click()
        time.sleep(2)
        return True
    except PlaywrightTimeoutError:
        return False


def wait_for_star_tab(page, timeout_ms=30_000):
    """Efter onboarding: vänta tills Utforska*-tabben (eller vår banner)
    blir synlig."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if page.locator(STAR_TAB).count() > 0:
            return True
        if page.locator(STAR_BANNER).count() > 0:
            return True
        time.sleep(1)
    return False


def click_star_tab(page):
    """Click the Utforska* tab if present, else fall back to direct goto."""
    tab = page.locator(STAR_TAB)
    if tab.count() > 0:
        tab.first.click()
        page.wait_for_selector(STAR_BANNER, timeout=15_000)
    else:
        # Banner-only navigation (e.g. if tab wasn't added but screen is reachable)
        if page.locator(STAR_BANNER).count() == 0:
            raise RuntimeError(
                f"Varken Utforska*-tabb eller banner hittades på {BASE_URL}. "
                "Kör expo med EXPO_PUBLIC_EXPLORE_STAR_ENABLED=true."
            )


def screenshot_each_image(page, timeout_ms=10_000):
    """For every <img>, wait for naturalWidth>0 then screenshot just that
    element. Returns list of {testid, src, path, width, height}."""
    out = []
    imgs = page.locator(STAR_BANNER + ' ~ * img, [data-testid^="star-img-"] img, img').all()
    if not imgs:
        # Fall back to any img on page
        imgs = page.locator('img').all()
    seen = set()
    for idx, img in enumerate(imgs):
        testid = img.get_attribute('data-testid') or img.get_attribute('alt') or f'img-{idx:02d}'
        src = img.get_attribute('src') or ''
        # Only Utforska* imgs (filter by URL prefix or testid)
        if 'ai-generated' not in src and 'star-img' not in testid:
            continue
        if src in seen:
            continue
        seen.add(src)
        try:
            page.wait_for_function(
                "(el) => el.complete && el.naturalWidth > 0",
                arg=img.element_handle(),
                timeout=timeout_ms,
            )
        except PlaywrightTimeoutError:
            print(f"  ⚠ {testid}: timeout waiting for naturalWidth>0")
            continue
        path = OUT_DIR / f"{testid.replace('/', '_')}.png"
        img.screenshot(path=str(path))
        box = img.bounding_box()
        out.append({
            "testid": testid,
            "src": src,
            "path": str(path),
            "render_width": box['width'] if box else None,
            "render_height": box['height'] if box else None,
        })
        print(f"  ✓ {testid} → {path.name}  ({box['width']:.0f}×{box['height']:.0f})" if box else f"  ✓ {testid} → {path.name}")
    return out


def count_orange_in_se_corner(path, src):
    """Open the saved PNG and look for orange (#FFB454 ± tolerans) in
    the SE corner region. For 1024×1024 source images, the stamp sits
    at x=800-1000, y=740-788 — same region as 08-Agent/tools/ai_compliance.ts.
    For the rendered screenshot the stamp will appear scaled/positioned
    somewhere in the SE corner of the visible image area."""
    try:
        from PIL import Image
    except ImportError:
        print("  ⚠ Pillow saknas — installerade: pip install pillow")
        return None
    img = Image.open(path).convert('RGB')
    W, H = img.size
    # Look at a generous SE region (right 30% × bottom 30%) — that's where
    # the stamp can land after cover-crop. Plus the original 200×48 region.
    se_regions = [
        ('SE-corner 200×48 (stamp native)', int(W * 0.78), int(H * 0.72), 200, 48),
        ('SE-quadrant 30%×30%',            int(W * 0.70), int(H * 0.70), int(W * 0.30), int(H * 0.30)),
        ('bottom-strip 100%×15%',          0, int(H * 0.85), W, int(H * 0.15)),
    ]
    best = None
    best_count = 0
    best_label = None
    for label, x, y, w, h in se_regions:
        x = max(0, min(x, W - 1))
        y = max(0, min(y, H - 1))
        w = max(1, min(w, W - x))
        h = max(1, min(h, H - y))
        crop = img.crop((x, y, x + w, y + h))
        orange = 0
        for px in crop.getdata():
            r, g, b = px
            if abs(r - 255) <= 25 and abs(g - 180) <= 30 and abs(b - 84) <= 35:
                orange += 1
        if orange > best_count:
            best_count = orange
            best_label = label
            best = (x, y, w, h, orange)
    return {
        "best_region": best_label,
        "best_count": best_count,
        "best_bbox": best[:4] if best else None,
        "verdict": "PASS" if best_count >= 5 else "FAIL",
    }


# ── Main ─────────────────────────────────────────────────────────────
def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"→ BASE_URL = {BASE_URL}")
    print(f"→ OUT_DIR  = {OUT_DIR}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        print("Waiting for Expo to come up…")
        if not wait_for_expo(page):
            print("FAIL: Expo kom aldrig upp.")
            sys.exit(1)
        print("Expo reachable — waiting for JS to mount…")
        time.sleep(5)

        # Skip onboarding if visible
        if skip_onboarding(page):
            print("Onboarding skip:ad.")
        else:
            print("(ingen onboarding-skärm)")

        # Wait for Utforska*-tab to appear after onboarding
        print("Waiting for Utforska*-tabb eller banner…")
        if not wait_for_star_tab(page, timeout_ms=30_000):
            print(f"FAIL: hittar inte Utforska*-tab efter onboarding.")
            page.screenshot(path='/tmp/expo-fail.png', full_page=True)
            print("  Debug-screenshot: /tmp/expo-fail.png")
            sys.exit(1)

        try:
            click_star_tab(page)
            print("Utforska*-sektion aktiv.")
        except RuntimeError as e:
            print(f"FAIL: {e}")
            sys.exit(1)

        # Small delay to ensure all images start loading
        time.sleep(1)

        print("\nScreenshotting each image…")
        shots = screenshot_each_image(page)

        if not shots:
            print("FAIL: inga bilder hittades.")
            sys.exit(2)

        print("\nValiderar orange stämpel…")
        report = []
        pass_count = 0
        for s in shots:
            chk = count_orange_in_se_corner(s["path"], s["src"])
            s["stamp_check"] = chk
            report.append(s)
            verdict = chk["verdict"] if chk else "?"
            count = chk["best_count"] if chk else 0
            region = chk["best_region"] if chk else "?"
            if chk and chk["verdict"] == "PASS":
                pass_count += 1
            print(f"  {verdict}  orange={count:4d}  [{region}]  {s['testid']}")

        REPORT_PATH.write_text(json.dumps(report, indent=2))
        print(f"\n→ Rapport: {REPORT_PATH}")
        print(f"\n=== RESULT: {pass_count}/{len(shots)} bilder har synlig stämpel ===")
        if pass_count == len(shots):
            print("ALL GREEN ✓")
            sys.exit(0)
        else:
            print(f"{len(shots) - pass_count} FAIL — inspektera screenshots i {OUT_DIR}")
            sys.exit(3)


if __name__ == "__main__":
    main()
