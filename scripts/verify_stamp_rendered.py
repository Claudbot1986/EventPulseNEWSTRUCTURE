#!/usr/bin/env python3
"""
verify_stamp_rendered.py — DOM-verifiering av AI-stämpel i renderad Utforska-feed.

Plan Del 2.5.2 (2026-09-05): bevisa att stämpeln är synlig i den RENDERADE vyn,
inte bara i bildfilen. Fil-stämplingen bevisas redan vid skrivtid
(checkAiStamp diff-verifiering i stamp_all_originals.ts / ai_compliance.ts).
Kvarvarande risk: resizeMode="cover" croppar bort stämpeln i UI (incidenten som
memory feedback_verify_ui_rendering bygger på).

Metod (inga pixel-läsningar av bildfiler — DOM-påståenden per projektregel):
  1. Öppna Expo web (default :8088), viewport 390×844 (telefon = produktens formfaktor;
     containrar är designade för 1.39–1.69:1 enligt ai_compliance.ts).
  2. Hoppa över onboarding ("Fortsätt till EventPulse") om den visas.
  3. Säkerställ Utforska-tabben är aktiv.
  4. Scrolla feeden, samla alla <img> vars src pekar på '/event-posters/'.
  5. Per bild, via DOM: src-klassificering (import-stamped/ förväntas),
     naturalWidth>0 (inte bruten), object-fit=cover, samt cover-crop-matten:
       scale = max(w/nw, h/nh);  synligt källfönster = centrerad rektangel w/scale × h/scale.
     Stämpelrektangeln i källkoordinater (08-Agent/tools/ai_compliance.ts::stampBox):
       top  = round(740 · nh/1024)  (740 för 1024-höga källor)
       höjd = 48, bredd = 202, vänster-hörn x∈[24, 226] ELLER höger-hörn x∈[nw−226, nw−24]
     PASS kräver: stämpelns y-range helt inom synligt fönster OCH minst ett hörns
     x-range helt inom synligt fönster.
  6. JSON-rapport + exit 0 endast om ALLA kort PASS (och ≥5 kort hittades,
     annars är det inte feeden som verifierats utan något tomt tillstånd).

Användning:
  python3 scripts/verify_stamp_rendered.py
  BASE_URL=http://localhost:8088 python3 scripts/verify_stamp_rendered.py
"""

import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8088")
REPORT_PATH = Path("/tmp/stamp-rendered-report.json")
MIN_CARDS = 5
SCROLL_PASSES = 14

CLICK_FIRST_CARD_JS = r"""
() => {
  // Klicka på första synliga eventkort (TouchableOpacity har cursor:pointer).
  const img = Array.from(document.querySelectorAll('img')).find(i =>
    (i.getAttribute('src')||'').includes('/event-posters/'));
  if (!img) return {clicked: false};
  let el = img.parentElement;
  for (let i = 0; el && i < 5; i++) {
    if (getComputedStyle(el).cursor === 'pointer') { el.click(); return {clicked: true}; }
    el = el.parentElement;
  }
  return {clicked: false};
}
"""

DOM_COLLECT_JS = r"""
() => {
  const out = [];
  document.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src.includes('/event-posters/')) return;
    // react-native-web renderar resizeMode='cover' som en SYSKON-div med
    // background-image + background-size: cover; själva <img> är osynlig
    // (opacity 0, css-accessibilityImage). Det synliga = syskon-diven.
    let frame = img.getBoundingClientRect();
    let frameFit = getComputedStyle(img).objectFit;
    let via = 'img';
    const parent = img.parentElement;
    if (parent) {
      for (const k of parent.children) {
        const cs = getComputedStyle(k);
        if (k.tagName === 'DIV' && cs.backgroundImage && cs.backgroundImage.includes('/event-posters/')) {
          frame = k.getBoundingClientRect();
          frameFit = cs.backgroundSize === 'cover' ? 'cover' : (cs.backgroundSize || frameFit);
          via = 'sibling-bg';
          break;
        }
      }
    }
    out.push({
      src,
      pathClass: src.includes('/import-stamped/') ? 'import-stamped'
               : src.includes('/ai-stamped/') ? 'ai-stamped' : 'other',
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      renderW: frame.width,
      renderH: frame.height,
      onScreen: frame.width > 0 && frame.height > 0 && frame.bottom > 0 && frame.top < window.innerHeight,
      objectFit: frameFit,
      via,
    });
  });
  return out;
}
"""

SCROLL_JS = r"""
(delta) => {
  // Hitta det scrollbara element som innehåller feeden (inner scroll container),
  // annars fallback på window.
  let best = null, bestLen = 0;
  document.querySelectorAll('div').forEach((d) => {
    const cs = getComputedStyle(d);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 100) {
      const nImgs = d.querySelectorAll('img').length;
      if (nImgs > bestLen) { best = d; bestLen = nImgs; }
    }
  });
  if (best) { best.scrollTop += delta; return { mode: 'inner', top: best.scrollTop }; }
  window.scrollBy(0, delta);
  return { mode: 'window', top: window.scrollY };
}
"""


def wait_for_expo(page, timeout_ms=120_000):
    """Bundling kan ta tid — försök tills root ger HTTP 200."""
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


def skip_onboarding(page, timeout_ms=10_000):
    """Onboarding → testprofil-väljare (Alpha/Beta/Gamma + samtycke) → appen."""
    try:
        btn = page.locator('[aria-label="Fortsätt till EventPulse"]')
        btn.first.wait_for(state="visible", timeout=timeout_ms)
        btn.first.click()
        time.sleep(2)
    except PlaywrightTimeoutError:
        pass
    # Testprofil-väljaren (visas efter onboarding i dev-läge)
    try:
        prof = page.locator('[aria-label="Logga in som Tomor G. — Alpha"]')
        if prof.count() > 0:
            prof.first.click()
            # Samtyckes-checkbox för analys (krävs för att gå vidare)
            consent = page.locator('[aria-label*="anonym användningsdata"]')
            if consent.count() > 0:
                consent.first.click()
            page.locator('[aria-label="Bekräfta val och fortsätt"]').first.click()
            time.sleep(3)
            return True
    except PlaywrightTimeoutError:
        pass
    return False


def ensure_utforska(page, timeout_ms=20_000):
    """Utforska är default-tabben; klicka ändå om en annan tabb är aktiv."""
    tab = page.locator('[aria-label="Utforska"]')
    if tab.count() > 0:
        tab.first.click()
        return True
    # Fallback: textbaserat
    txt = page.locator('text="Utforska"')
    if txt.count() > 0:
        txt.first.click()
        return True
    return False


def analyze_card(card):
    """Cover-crop-matte mot stämpelrektangeln. Returnerar (verdict, detail-dict)."""
    nw, nh = card["naturalWidth"], card["naturalHeight"]
    w, h = card["renderW"], card["renderH"]
    if not card["complete"] or nw <= 0:
        return "FAIL", {"reason": "broken image (naturalWidth=0)"}
    if w <= 0 or h <= 0:
        return "FAIL", {"reason": "not rendered (zero size)"}
    if card["objectFit"] != "cover":
        return "FAIL", {"reason": f"object-fit={card['objectFit']!r} (förväntat 'cover')"}

    scale = max(w / nw, h / nh)
    vis_w, vis_h = w / scale, h / scale
    x0 = (nw - vis_w) / 2
    y0 = (nh - vis_h) / 2

    stamp_top = 740 if nh >= 1024 else round(nh / 1024 * 740)
    stamp_h, stamp_w, inset = 48, 202, 24

    y_in = y0 <= stamp_top and (stamp_top + stamp_h) <= (y0 + vis_h)
    left_x_in = x0 <= inset and (inset + stamp_w) <= (x0 + vis_w)
    right_x_in = x0 <= (nw - inset - stamp_w) and (nw - inset) <= (x0 + vis_w)

    detail = {
        "visible_src_window": {
            "x": [round(x0), round(x0 + vis_w)],
            "y": [round(y0), round(y0 + vis_h)],
        },
        "stamp_src_rect": {
            "y": [stamp_top, stamp_top + stamp_h],
            "x_left": [inset, inset + stamp_w],
            "x_right": [nw - inset - stamp_w, nw - inset],
        },
        "y_contained": y_in,
        "left_corner_contained": left_x_in,
        "right_corner_contained": right_x_in,
    }
    verdict = "PASS" if (y_in and (left_x_in or right_x_in)) else "FAIL"
    if not y_in:
        detail["reason"] = "stämpelns y-range utanför synligt fönster"
    elif not (left_x_in or right_x_in):
        detail["reason"] = "inget stämpel-hörns x-range inom synligt fönster"
    return verdict, detail


def main():
    print(f"→ BASE_URL = {BASE_URL}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        print("Väntar på Expo web…")
        if not wait_for_expo(page):
            print("FAIL: Expo kom aldrig upp.")
            sys.exit(1)

        print("Väntar på att appen monterar…")
        time.sleep(8)

        if skip_onboarding(page):
            print("Onboarding: hoppade över.")
        if not ensure_utforska(page):
            print("FAIL: Utforska-tabben hittades inte.")
            sys.exit(1)
        time.sleep(3)

        # Mät medan vi scrollar: varje kort ska mätas i det ögonblick det
        # är synligt (inte bara i slutläget där bara sista skärmen syns).
        collected = {}  # src → bästa mätning (onScreen föredras)
        state = page.evaluate(SCROLL_JS, -100000)  # nollställ scroll
        time.sleep(1.5)
        for i in range(SCROLL_PASSES + 1):
            for c in page.evaluate(DOM_COLLECT_JS):
                prev = collected.get(c["src"])
                if prev is None or (c["onScreen"] and not prev["onScreen"]):
                    collected[c["src"]] = c
            state = page.evaluate(SCROLL_JS, 800)
            time.sleep(1.2)
        print(f"Scroll+mätning ({SCROLL_PASSES + 1} pass): {state['mode']} → top={state['top']}")

        cards = list(collected.values())
        print(f"\nHittade {len(cards)} unika event-posters-bilder i DOM:en.")

        report = []
        n_pass = n_fail = n_offscreen = 0
        for c in cards:
            if not c["onScreen"]:
                # FlatList virtualiserar — kort som aldrig mättes synligt
                # rapporteras som ej mätta (ej FAIL).
                n_offscreen += 1
                continue
            verdict, detail = analyze_card(c)
            entry = {
                "src": c["src"],
                "pathClass": c["pathClass"],
                "natural": [c["naturalWidth"], c["naturalHeight"]],
                "render": [round(c["renderW"]), round(c["renderH"])],
                "objectFit": c["objectFit"],
                "verdict": verdict,
                **detail,
            }
            report.append(entry)
            if verdict == "PASS":
                n_pass += 1
                status_icon = "✓"
            else:
                n_fail += 1
                status_icon = "✗"
            win = detail.get("visible_src_window")
            stamp = detail.get("stamp_src_rect")
            win_str = f"y={win['y']} stämpel-y={stamp['y']}" if (win and stamp) else "(fönster saknas)"
            print(
                f"  {status_icon} {verdict}  [{c['pathClass']:>14}|{c.get('via','?'):>9}] "
                f"{c['naturalWidth']}×{c['naturalHeight']} → {round(c['renderW'])}×{round(c['renderH'])} "
                f"{win_str}  {c['src'].rsplit('/', 1)[-1][:52]}"
                + (f"  ({detail.get('reason')})" if verdict == "FAIL" else "")
            )

        REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(f"\n→ Rapport: {REPORT_PATH}")
        print(
            f"=== RESULTAT: {n_pass} PASS / {n_fail} FAIL "
            f"(av {n_pass + n_fail} synliga, {n_offscreen} utanför skärm ej mätta) ==="
        )

        # ── Details-vyn ── öppna första kortet och mät detailsImage (h 240)
        detail_report = []
        click = page.evaluate(CLICK_FIRST_CARD_JS)
        if click.get("clicked"):
            time.sleep(3)
            for c in page.evaluate(DOM_COLLECT_JS):
                if not c["onScreen"] or not c["complete"] or c["naturalWidth"] <= 0:
                    continue
                verdict, detail = analyze_card(c)
                detail_report.append({
                    "src": c["src"],
                    "verdict": verdict,
                    "render": [round(c["renderW"]), round(c["renderH"])],
                    **detail,
                })
                icon = "✓" if verdict == "PASS" else "✗"
                win = detail.get("visible_src_window")
                stamp = detail.get("stamp_src_rect")
                win_str = f"y={win['y']} stämpel-y={stamp['y']}" if (win and stamp) else "(fönster saknas)"
                print(
                    f"  {icon} DETAILS {verdict}  {c['naturalWidth']}×{c['naturalHeight']} → "
                    f"{round(c['renderW'])}×{round(c['renderH'])} {win_str}  "
                    f"{c['src'].rsplit('/', 1)[-1][:52]}"
                    + (f"  ({detail.get('reason')})" if verdict == "FAIL" else "")
                )
            if detail_report:
                REPORT_PATH.write_text(json.dumps({"feed": report, "details": detail_report}, indent=2, ensure_ascii=False))
        else:
            print("  (kunde inte öppna details-vy — feed-resultatet gäller)")

        if n_pass + n_fail < MIN_CARDS:
            print(f"FAIL: bara {n_pass + n_fail} synliga kort (<{MIN_CARDS}) — feeden laddade inte tillräckligt.")
            sys.exit(2)
        not_stamped_path = [r for r in report if r["pathClass"] == "other"]
        if not_stamped_path:
            print(f"FAIL: {len(not_stamped_path)} kort pekar INTE på en stämplad path:")
            for r in not_stamped_path:
                print(f"    {r['src']}")
            sys.exit(4)
        if n_fail > 0:
            print("FAIL: minst ett kort döljer/klipper bort stämpeln i renderad vy.")
            sys.exit(3)
        details_fail = [d for d in detail_report if d["verdict"] != "PASS"]
        if details_fail:
            print("FAIL: details-vyn döljer stämpeln.")
            sys.exit(3)
        print("ALL GREEN ✓ — stämpeln verkar synlig i renderad feed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
