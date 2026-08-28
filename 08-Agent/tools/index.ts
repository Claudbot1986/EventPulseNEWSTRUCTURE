/**
 * 08-Agent/tools/index — barrel re-export of all tool modules.
 *
 * Why this exists:
 *   The server.ts and tests previously imported each tool module directly
 *   (`./tools/record_feedback`, `./tools/search_events`, …). As the tool
 *   surface grew this became a noise-heavy import list. The barrel keeps
 *   call sites slim while still letting sub-paths import individually
 *   when they need only one symbol.
 *
 * Phase 1 feedback surface (the only thing the coordinator for this
 * milestone needs):
 *   - recordFeedback           — the mandated tool
 *   - validateFeedbackInput    — pure validator shared with the wire
 *   - ALLOWED_INTERACTIONS     — enum of every persisted interaction
 *   - ALLOWED_REJECT_REASONS   — enum of reject_reason buckets
 *   - DEFAULT_REJECT_REASON    — the "no reject_reason supplied" fallback
 */

export {
  recordFeedback,
  validateFeedbackInput,
  ALLOWED_INTERACTIONS,
  ALLOWED_REJECT_REASONS,
  DEFAULT_REJECT_REASON,
  type RecordFeedbackResult,
} from './record_feedback';
