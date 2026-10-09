import { checkIndependence } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/independenceCheck';
import type { EditorialDraft } from '/Users/claudgashi/EventPulse/04-Normalizer/editorial/types';

const draft: EditorialDraft = {
  text: 'Hawk on Flight firar sitt 50-årsjubileum med en turné som stannar till på Makeriet i Stockholm. Kvällen samlar bandet i en gemensam konsertupplevelse med fokus på gemenskap och musik. En avstation på en turné som markerar fem decennier i rörelse.',
  word_count: 40, info_level: 'LOW',
  meta: { model: 'minimax-M3', prompt_version: 'editorial-writer/v1', generated_at: '2026-10-08' },
};

const source = `<p>HAWK ON FLIGHT – 50-ÅRSJUBILEUMSTURNÉ 2026</p>
<p>Hawk On Flight bildades 1976 och firar 50 år som ett av Sveriges mest långlivade och inflytelserika jazzrock/fusionband. Under hösten 2026 ger sig bandet ut på en efterlängtad 50-årsjubileumsturné – den mest betydelsefulla i gruppens historia.
Bassist och primus motor Matz Nilsson har varit med sedan starten. Gitarristen Staffan William-Olsson, som tog över efter Ulf Wakenius 1982, är även han en central del av bandets sound. Dagens sättning kompletteras av Marcos Ubeda(klaviaturer), Björn Arkö (saxofon och NuRAD/synthsax) samt Zoltan Csörcz (trummor). Åke Linton ansvarar, som alltid, för ett förstklassigt ljud.
Under de senaste åren har Hawk On Flight genomfört tre omfattande turnéer runt om i Sverige, med överväldigande respons och ett stort antal utsålda konserter</p>`;

const result = checkIndependence({ draft, sourceDescription: source });
console.log('Independence result:', JSON.stringify(result, null, 2));
