import { extractSemantics } from '../editorial/semanticExtractor';

const RAW = `En kväll med symfoniska mästerverk i Linköping Konsert & Kongress 8 oktober Rachmaninovs andra pianokonsert -- samt Berwald och Sibelius Med en av Europas främsta ungdomssymfoniorkestrar, Zürich Youth Orchestra, som spelar på en fullständigt professionell nivå. Det är en fullstor symfoniorkester med 95 musiker. Före konserten underhåller virtuosa kammarmusikensembler ur orkestern i entréhallen till Linköping Konsert & Kongress. Programmet är rena önskekonserten. Först uvertyren till Estrella de Soria av Franz Berwald, vår store svenske symfoniker -- musik fylld av energi, dramatik och oväntade vändningar, personlig och omisskännligt Berwald. Därefter en av romantikens mest älskade verk: Rachmaninovs andra pianokonsert. Musik som går rakt in i hjärtat, med stora känslor, svepande melodier och ett piano som både sjunger och brusar. Många känner igen teman, även om de inte vet varifrån. Mer romantiskt än så blir det knappast. Slutligen Jean Sibelius första symfoni. Här öppnar sig ett nordiskt landskap, mörkt skimrande och samtidigt fullt av kraft och liv -- en symfoni som griper tag och håller lyssnaren i ett fast grepp från första ton till sista. Pianosolist är den unge stjärnpianisten Ilya Shmukler, nyligen vinnare av den internationella pianotävlingen Concours Géza Anda. Presenteras av: Specialised Travel Concert Touring ltd Insläpp: kl 18:30 Showstart: kl 19:00 Längd: ca 2 timmar & 10 minuter Paus: Ja Lokal: Crusellhallen Rullstolsplatser bokas bokas via Ticketmasters tillgä`;

const r = extractSemantics(RAW);
console.log('ensemble:', r.ensemble);
console.log('orchestra_size:', r.orchestra_size);
console.log('soloist:', r.soloist_name, '/', r.soloist_role);
console.log('composers:', r.composers);
console.log('works:', JSON.stringify(r.works, null, 2));
console.log('duration_from_text:', r.duration_minutes_from_text);
console.log('evidence:', JSON.stringify(r.evidence, null, 2));
