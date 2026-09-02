#!/usr/bin/env python3
"""EventPulse UI-review — steg 1: rendera vy och ta screenshot.

Del av den isolerade visuella UI-review-loopen (se scripts/ui-review/README.md).

SÄKERHETSREGL: Claude Code får ALDRIG läsa PNG-filerna som denna script sparar.
Claude konsumerar endast textutdata: stdout + dom-audit.json.

Återanvänder rendermönstret från runtime/verify/verify_utforska.py och
runtime/mockups/take_before_screenshot.py (Expo web på port 8088).

Användning:
  python3 scripts/ui-review/ui-screenshot.py --view utforska [--url URL] [--out-dir DIR]

Vy-nycklar motsvarar tabbar i 06-UI/components/BottomTabBar.js (aria-label).
"""
import argparse
import asyncio
import datetime
import json
import sys
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

# Repo-rot = tre nivåer upp från detta script (inga hårdkodade absoluta paths)
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_URL = "http://localhost:8088"
DEFAULT_OUT_ROOT = REPO_ROOT / "runtime" / "verify" / "ui-review"

# Tabbar i 06-UI/components/BottomTabBar.js (accessibilityLabel)
VIEW_TAB_LABELS = {
    "utforska": "Utforska",
    "hem": "Hem",
    "notiser": "Notiser",
    "profil": "Profil",
}
DEFAULT_VIEW = "utforska"
VIEWPORT = {"width": 393, "height": 852}  # iPhone 14 Pro CSS-pixlar
DEVICE_SCALE_FACTOR = 2


def wait_for_server(url: str, timeout_s: int) -> bool:
    """Polla tills Expo web svarar HTTP 200."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


async def bypass_onboarding(page) -> str:
    """Hoppa över onboarding om den visas. Returnerar vad som hände."""
    for selector, description in [
        ("text=Hoppa över", "Hoppa över"),
        ("text=Fortsätt utan val", "Fortsätt utan val"),
        ('[aria-label="Fortsätt till EventPulse"]', "Fortsätt till EventPulse"),
    ]:
        try:
            await page.wait_for_selector(selector, timeout=4000)
            await page.click(selector)
            print(f"[screenshot] klickade '{description}' (onboarding bypass)")
            await asyncio.sleep(3)
            await page.wait_for_load_state("networkidle", timeout=15000)
            return description
        except Exception:
            continue
    print("[screenshot] onboarding ej närvarande, fortsätter")
    await asyncio.sleep(1)
    return "none"


async def complete_user_picker(page) -> bool:
    """Slutför GDPR/testprofil-gaten (UserPickerScreen) om den visas.

    Playwright-kontexten är färsk varje körning (ingen AsyncStorage), så
    gaten återkommer alltid. Returnerar True om flödet slutfördes.
    """
    try:
        await page.wait_for_selector('[aria-label^="Logga in som"]', timeout=6000)
    except Exception:
        return False
    try:
        await page.click('[aria-label="Logga in som Tomor G. — Alpha"]', timeout=5000)
        await page.click('[role="checkbox"]', timeout=5000)
        await page.click('[aria-label="Bekräfta val och fortsätt"]', timeout=5000)
        print("[screenshot] slutförde testprofil-gaten (Alpha + samtycke + Fortsätt)")
        await asyncio.sleep(3)
        await page.wait_for_load_state("networkidle", timeout=15000)
        return True
    except Exception as e:
        print(f"[screenshot] VARNING: kunde inte slutföra testprofil-gaten: {e}", file=sys.stderr)
        return False


async def scroll_feed(page, y_px: int) -> bool:
    """Scrolla feeden y-pixler.

    RN Web (Expo web) scrollar ofta i en inre div-container, inte i window —
    därför hittar vi den scrollbara containern först och faller tillbaka på
    window.scrollTo. Returnerar True om en inre container scrollades.
    """
    scrolled_inner = await page.evaluate(
        """(y) => {
          const divs = Array.from(document.querySelectorAll('div'));
          const scroller = divs.find(
            (el) => el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 100
          );
          if (scroller) { scroller.scrollTop = y; return true; }
          window.scrollTo(0, y);
          return false;
        }""",
        y_px,
    )
    return bool(scrolled_inner)


async def audit_dom(page) -> dict:
    """Textbaserad DOM/accessibility-audit — det Claude får läsa i stället för bilden."""
    images_total = 0
    images_loaded = 0
    image_sample = []
    for i, img in enumerate(await page.query_selector_all("img")):
        images_total += 1
        try:
            src = await img.get_attribute("src")
            natural_w = await page.evaluate("(el) => el.naturalWidth", img)
            complete = await page.evaluate("(el) => el.complete", img)
        except Exception:
            continue
        if natural_w and natural_w > 0:
            images_loaded += 1
        if i < 12:
            image_sample.append({
                "i": i,
                "src": (src or "")[:140],
                "naturalWidth": natural_w,
                "complete": complete,
            })

    buttons = []
    for btn in (await page.query_selector_all('[role="button"], [role="tab"], button'))[:30]:
        try:
            label = await btn.get_attribute("aria-label")
            text = (await btn.inner_text() or "").strip()[:60]
            selected = await btn.get_attribute("aria-selected")
            buttons.append({"label": label, "text": text, "selected": selected})
        except Exception:
            continue

    try:
        body_text = (await page.evaluate("() => document.body.innerText") or "")[:2000]
    except Exception:
        body_text = ""

    return {
        "images": {"total": images_total, "loaded": images_loaded, "sample_first_12": image_sample},
        "buttons_first_30": buttons,
        "body_text_sample": body_text,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description="EventPulse UI screenshot för vision-review")
    parser.add_argument("--view", default=DEFAULT_VIEW, choices=sorted(VIEW_TAB_LABELS.keys()))
    parser.add_argument("--url", default=DEFAULT_URL, help=f"Expo web-URL (default {DEFAULT_URL})")
    parser.add_argument("--out-dir", default=None, help="utkatalog (default runtime/verify/ui-review/manual/<ts>)")
    parser.add_argument("--server-timeout", type=int, default=90, help="sekunder att vänta på Expo web")
    args = parser.parse_args()

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else DEFAULT_OUT_ROOT / "manual" / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[screenshot] vy={args.view} url={args.url}")
    if not wait_for_server(args.url, args.server_timeout):
        print(f"[screenshot] FEL: Expo web svarar inte på {args.url} inom {args.server_timeout}s", file=sys.stderr)
        print(f"[screenshot] Starta med: cd 06-UI && npx expo start --web --port 8088 --non-interactive", file=sys.stderr)
        return 1

    console_logs = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT, device_scale_factor=DEVICE_SCALE_FACTOR
        )
        page = await context.new_page()
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: console_logs.append(f"[pageerror] {err}"))

        try:
            await page.goto(args.url, wait_until="networkidle", timeout=60000)
        except Exception as e:
            print(f"[screenshot] networkidle-timeout, faller tillbaka på domcontentloaded: {e}")
            await page.goto(args.url, wait_until="domcontentloaded", timeout=60000)

        await page.wait_for_selector("#root, [data-reactroot]", timeout=30000)
        await bypass_onboarding(page)
        await complete_user_picker(page)

        # Navigera till vald tabb (default landning är 'hem')
        if args.view != "hem":
            tab_label = VIEW_TAB_LABELS[args.view]
            try:
                await page.click(f'[aria-label="{tab_label}"]', timeout=10000)
                print(f"[screenshot] klickade tabb '{tab_label}'")
                await asyncio.sleep(2)
                await page.wait_for_load_state("networkidle", timeout=20000)
            except Exception as e:
                print(f"[screenshot] FEL: kan inte klicka tabb '{tab_label}': {e}", file=sys.stderr)
                await browser.close()
                return 2
            # Gaten kan ligga ovanför tabbarnas vy — slutför även efter tabbklick
            await complete_user_picker(page)
        else:
            print("[screenshot] vy 'hem' är default-landning, ingen tabbklick behövs")

        # Vänta på att innehåll/images laddar (inte fatal om inga images finns)
        try:
            await page.wait_for_selector("img", timeout=20000)
        except Exception:
            print("[screenshot] inga <img> dök upp inom 20s (kan vara tom vy)")
        try:
            await page.wait_for_load_state("networkidle", timeout=30000)
        except Exception:
            pass
        await asyncio.sleep(3)

        audit = await audit_dom(page)

        # Screenshot 1: övre viewport (primär för vision-review)
        top_path = out_dir / f"view-{args.view}-top.png"
        await page.evaluate("window.scrollTo(0, 0)")
        await scroll_feed(page, 0)
        await asyncio.sleep(1)
        await page.screenshot(path=str(top_path), full_page=False)

        # Screenshot 2: mitt-i-listan (densitet/konsistens i feed).
        # RN Web scrollar i inre container — scroll_feed hittar den.
        mid_path = out_dir / f"view-{args.view}-mid.png"
        scrolled_inner = await scroll_feed(page, 700)
        print(f"[screenshot] mid-scroll: {'inre container' if scrolled_inner else 'window'}")
        await asyncio.sleep(1)
        await page.screenshot(path=str(mid_path), full_page=False)

        # Screenshot 3: hel sida (kontext; kan bli hög — vision-review filtrerar på storlek)
        full_path = out_dir / f"view-{args.view}-full.png"
        try:
            await page.screenshot(path=str(full_path), full_page=True)
        except Exception as e:
            print(f"[screenshot] full-page-screenshot misslyckades (ej fatal): {e}")
            full_path = None

        await browser.close()

    report = {
        "view": args.view,
        "url": args.url,
        "timestamp": timestamp,
        "viewport": {**VIEWPORT, "device_scale_factor": DEVICE_SCALE_FACTOR},
        **audit,
        "console_logs_last_30": console_logs[-30:],
        "screenshots": {
            "top": str(top_path),
            "mid": str(mid_path),
            "full": str(full_path) if full_path else None,
        },
    }
    audit_path = out_dir / "dom-audit.json"
    audit_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))

    print(f"[screenshot] top: {top_path}")
    print(f"[screenshot] mid: {mid_path}")
    print(f"[screenshot] full: {full_path if full_path else '(misslyckades)'}")
    print(f"[screenshot] dom-audit: {audit_path}")
    print(f"[screenshot] images: {audit['images']['loaded']}/{audit['images']['total']} laddade")

    if audit["images"]["total"] > 0 and audit["images"]["loaded"] == 0:
        print("[screenshot] VARNING: 0 images laddade — tom trasig vy?", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))