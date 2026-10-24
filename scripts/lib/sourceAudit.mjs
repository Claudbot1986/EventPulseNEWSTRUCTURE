/**
 * sourceAudit.mjs — är en källa med noll rader UTREDD och medvetet tom?
 *
 * En aktiv källa som ger 0 events i databasen har två helt olika betydelser:
 *
 *   fastnar          — källan BORDE ge events men gör det inte. Detta är
 *                      listan operatören ska jobba ifrån.
 *   verifierat-tom   — källan har ingen eventyta (parken publicerar inget,
 *                      lokalen har ingen evenemangs-CPT, säsongen är slut).
 *                      0 rader är det RIKTIGA svaret.
 *
 * Skillnaden får inte avgöras av en gissning. Den avgörs av en AUDIT som
 * ligger i källfilens metadata och som innehåller bevis:
 *
 *   audit_status    — vad som gjordes (t.ex. "adapter_wired")
 *   audit_reason    — varför 0 events är riktigt (t.ex. "säsong_slut")
 *   audit_evidence  — mätningen som stöder det (måste vara med)
 *
 * Alla tre krävs. En audit_status utan bevis är inte en audit — annars
 * kan en tom metadata-objekt göra en trasig källa "verifierad" och därmed
 * dölja den från listan.
 */

/**
 * Är metadatan en fullständig audit av en medvetet tom källa?
 *
 * Negativ kontroll: alla tre fälten måste finnas. Ett tomt fält räknas
 * som saknat — annars skulle `audit_reason: ""` passera som audit.
 */
export function isVerifiedEmptySource(metadata) {
  const m = metadata ?? {};
  return Boolean(m.audit_status && m.audit_reason && m.audit_evidence);
}

/**
 * Klassificera en källa med noll rader.
 *
 * Returnerar { state, audit } där state är 'verifierat-tom' eller 'fastnar'.
 */
export function classifyZeroRowSource(src) {
  const metadata = src?.metadata ?? {};
  if (!isVerifiedEmptySource(metadata)) {
    return { state: 'fastnar', audit: null };
  }
  return {
    state: 'verifierat-tom',
    audit: {
      status: metadata.audit_status,
      reason: metadata.audit_reason,
      evidence: metadata.audit_evidence,
    },
  };
}
