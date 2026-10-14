/**
 * nliJudge.ts — Alternativ C från forskningsanalys (2026-10-14).
 *
 * Natural Language Inference-judge som sista steg i factuality-check.
 * Används när substring-match och stemming INTE räcker för att verifiera
 * ett claim mot Profile-evidens.
 *
 * Forskningsreferens:
 *   - FActScore (Min et al. 2023) — "decompose into atomic claims, verify each"
 *   - SAFE (Wei et al. 2024) — "use LLM as agent to verify claims"
 *   - FacTool (Chern et al. 2023) — "agreement verification via LLM"
 *   - LLM-AggreFact (Tang et al. 2024) — meta-benchmark för factuality
 *
 * Begränsningar (per forskning):
 *   - LLM-as-judge har ~75-77% balanced accuracy (Bespoke-7B 77.4%, gpt-4-turbo 76.2%)
 *   - Bättre än substring, sämre än mänsklig annotering
 *   - Kostsamt: 1 extra M3-anrop per claim
 *
 * Säkerhetsantaganden:
 *   - Judge anropas ENDAST för materiala claims (inte stilord)
 *   - Judge-svar 'yes' → SUPPORTED med låg confidence (match_type='nli-judge')
 *   - Judge-svar 'no' eller 'unsure' → UNSUPPORTED (default, säkrare)
 *   - Judge kan INTE användas för claims som tidigare matchats via substring
 *     (deterministiska metoder kör FÖRST, judge som sista utväg)
 */
import type { LlmClient } from './editorialWriter';

export type NliVerdict = 'yes' | 'no' | 'unsure';

export interface NliJudgeOptions {
  /** Max antal claims att skicka till judge per event (default 5). */
  maxClaimsPerEvent?: number;
  /** Timeout per judge-anrop i ms (default 5000). */
  timeoutMs?: number;
  /** Minsta antal claim-ord för att kvalificera som "material". */
  minMaterialWords?: number;
}

export interface NliEvidence {
  claim: string;
  evidence_phrases: string[];
}

/**
 * Bygger en prompt som frågar M3 om ett claim stöds av evidens.
 *
 * Prompten är utformad för att minimera tvetydighet:
 *   - Tydlig Y/N/I-uppgift (Yes/No/Unsure)
 *   - Claim citerat ordagrant
 *   - Evidens listad som punktlista
 *   - Instruktion att inte gissa — 'unsure' är OK
 */
export function buildNliPrompt(claim: string, evidencePhrases: string[]): string {
  const evidenceList = evidencePhrases
    .slice(0, 15)  // max 15 fraser för att inte spränga prompt-budget
    .map((e, i) => `${i + 1}. ${e}`)
    .join('\n');
  return `Är följande påstående (claim) stött av bevisen nedan? Svara med EXAKT ett av:
- Y (yes) = påståendet stöds av bevisen
- N (no) = påståendet stöds INTE av bevisen
- I (insure/unsure) = du kan inte avgöra

Påstående: "${claim}"

Bevis:
${evidenceList}

Svar (Y/N/I):`;
}

/**
 * Kör M3 som NLI-judge för en lista av (claim, evidence-par).
 *
 * Returnerar en map: claim → verdict. Claims som är tomma/materiala-filteras
 * bort returnerar INTE i kartan (caller hanterar dem som UNSUPPORTED).
 *
 * Säkerhetsantagande: vi tolkar M3-svaret strikt. Om svaret inte är exakt
 * Y/N/I (med tillåtna variationer som "Yes", "YES", "y") returnerar vi 'unsure'
 * (säkrare alternativ).
 */
export async function runNliJudge(
  llm: LlmClient,
  evidence: NliEvidence[],
  options: NliJudgeOptions = {},
): Promise<Map<string, NliVerdict>> {
  const result = new Map<string, NliVerdict>();
  const maxClaims = options.maxClaimsPerEvent ?? 5;
  const timeoutMs = options.timeoutMs ?? 5000;
  const minWords = options.minMaterialWords ?? 1;

  // Filtrera till materiala claims (inte bara stopwords/stilord)
  const material = evidence
    .filter(e => e.claim.split(/\s+/).filter(w => w.length >= 4).length >= minWords)
    .slice(0, maxClaims);

  // Kör varje claim parallellt (med concurrency från runWithConcurrency caller)
  for (const ev of material) {
    const prompt = buildNliPrompt(ev.claim, ev.evidence_phrases);
    try {
      const verdict = await Promise.race([
        llm.generate({
          prompt,
          system: 'Du är en NLI-judge. Svara strikt Y, N, eller I.',
          maxTokens: 5,    // 'Y' / 'N' / 'I' — 1 tecken räcker
          temperature: 0,  // deterministiskt
        }).then(parseNliVerdict),
        new Promise<NliVerdict>((_, reject) =>
          setTimeout(() => reject(new Error('nli-timeout')), timeoutMs)
        ),
      ]);
      result.set(ev.claim, verdict);
    } catch {
      // Vid timeout eller fel — 'unsure' är default, markerar som UNSUPPORTED
      // i caller. Detta är SÄKERT (false positive = 'yes' vore riskabelt).
      result.set(ev.claim, 'unsure');
    }
  }
  return result;
}

function parseNliVerdict(raw: string): NliVerdict {
  const t = raw.trim().toUpperCase();
  // Strikt matchning — undvik tvetydighet
  if (t === 'Y' || t === 'YES' || t === 'JA') return 'yes';
  if (t === 'N' || t === 'NO' || t === 'NEJ') return 'no';
  if (t === 'I' || t === 'UNSURE' || t === 'OSÄKER' || t === '?') return 'unsure';
  // Om M3 producerar längre text (t.ex. "Yes." eller "I think yes.")
  // — extrahera första tecken
  const first = t[0];
  if (first === 'Y') return 'yes';
  if (first === 'N') return 'no';
  return 'unsure';
}
