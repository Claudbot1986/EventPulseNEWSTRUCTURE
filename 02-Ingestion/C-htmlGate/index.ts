/**
 * C-htmlGate — HTML path gate module
 *
 * Three-step structure:
 *   C1 — Pre-HTML Gate:  Lightweight fetch + DOM inspection, flat diagnostic
 *   C2 — HTML Gate:      Weighted scoring + candidate quality + final verdict
 *   C3 — AI Extract:     AI-augmented extraction for complex/unusual pages
 *
 * Pipeline: JSON-LD → Network → [C1 screening] → C2 gate → [C3 AI if promising+no events] → Render → Blocked/Review
 *
 * Usage:
 *   import { evaluateHtmlGate } from './C2-htmlGate/C2-htmlGate';         // C2 (default)
 *   import { screenUrl } from './C1-preHtmlGate/C1-preHtmlGate'; // C1
 *   import { evaluateAiExtract } from './C3-aiExtractGate/C3-aiExtractGate'; // C3
 *
 * Backwards compatibility: evaluateHtmlGate from this index re-exports from C2.
 */
export { evaluateHtmlGate, type HtmlGateResult, type HtmlVerdict } from './C2-htmlGate/C2-htmlGate';
export { screenUrl, screenUrlWithDerivedRules, type PreGateResult, type PreGateCategorization } from './C1-preHtmlGate/C1-preHtmlGate';
export { evaluateAiExtract, type AiExtractResult, type AiVerdict, type AiExtractedEvent, type AiExtractor } from './C3-aiExtractGate/C3-aiExtractGate';
export { discoverEventCandidates, type FrontierDiscoveryResult, type CandidatePage } from './C0-htmlFrontierDiscovery';
