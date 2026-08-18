from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

PageType = Literal["A", "B", "C", "D", "UNKNOWN"]
Confidence = Literal["high", "medium", "low"]


@dataclass
class SourceRecord:
    source_id: str
    name: str
    url: str
    city: str


@dataclass
class Classification:
    page_type: PageType
    classification_confidence: Confidence
    classification_reason: str
    evidence: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StageResult:
    stage: str
    source_id: str
    success: bool
    events_found: int
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)
