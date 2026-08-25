from __future__ import annotations

from .models import Classification


def classify_source(url: str) -> Classification:
    u = (url or "").lower()
    evidence: list[str] = []

    if any(k in u for k in ["/api", "ticketmaster", "eventim", "biljett"]):
        evidence.append("api/provider keywords in URL")
        return Classification("A", "medium", "URL matches direct/API patterns", evidence)

    if any(k in u for k in ["json", "feed", "calendar.ics", "/events.json"]):
        evidence.append("feed/json keywords in URL")
        return Classification("B", "medium", "URL matches feed/JSON patterns", evidence)

    if any(k in u for k in ["list", "schema", "kalender", "event"]) and "?" in u:
        evidence.append("listing/query-heavy URL")
        return Classification("D", "low", "Likely JS listing page from URL signals", evidence)

    if any(k in u for k in ["kalender", "event", "program", "evenemang"]):
        evidence.append("html event keywords in URL")
        return Classification("C", "medium", "Likely HTML event page", evidence)

    return Classification("UNKNOWN", "low", "No strong routing signal from URL", ["weak URL signals"])
