#!/usr/bin/env node
/**
 * PostToolUse hook: varnar Claude när en UI-fil redigeras som påverkar
 * rendering av bilder (resizeMode, Image, view-dimensioner, aspectRatio).
 *
 * Anledning: pixel-nivå verifiering av stämplar/watermarks i källfilen
 * räcker INTE. UI-renderingen (resizeMode="cover" croppar t.ex. SE-hörnet
 * i icke-kvädratisk view) kan gömma artifact:en helt. Vi måste rendera
 * simulerad UI-vy och bekräfta att artifact:en är inom synlig yta.
 *
 * Hook-input (stdin): JSON { tool: "Edit", params: { file_path, old_string, new_string } }
 * Hook-output (stderr): varning som Claude tar emot i nästa tool-resultat.
 */

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const tool = data.tool || data.params?.tool || '';
    if (!['Edit', 'Write', 'MultiEdit'].includes(tool)) return;

    const filePath = (data.params && data.params.file_path) || '';

    // Bara UI-filer i EventPulse Expo-appen
    const isUiFile =
      filePath.includes('/06-UI/') &&
      /\.(js|jsx|tsx|ts)$/.test(filePath);
    if (!isUiFile) return;

    const newString =
      (data.params && (data.params.new_string || data.params.content)) || '';

    // Mönster som tyder på att UI-rendering påverkas
    const concerns = [];
    if (/resizeMode\s*[:=]/.test(newString)) concerns.push('resizeMode');
    if (/<Image\b/.test(newString)) concerns.push('<Image>');
    if (/styles\.(cardImage|image|avatar|heroImage|imageWrap|bannerImage)/i.test(newString))
      concerns.push('image-style');
    if (/aspectRatio/.test(newString)) concerns.push('aspectRatio');
    if (/(height|width):\s*\d+/.test(newString)) concerns.push('numeric width/height');

    if (concerns.length === 0) return;

    process.stderr.write(`\n⚠️  UI-RENDER VERIFIER ⚠️\n`);
    process.stderr.write(`Fil: ${filePath}\n`);
    process.stderr.write(`Påverkar: ${concerns.join(', ')}\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`MÅSTE verifiera med simulerad UI-rendering innan du säger "klart":\n`);
    process.stderr.write(`  1. Bestäm view-dimensionerna som koden använder (height/width/aspectRatio)\n`);
    process.stderr.write(`  2. Rendera bilden med sharp.resize() i samma dimensioner och resizeMode\n`);
    process.stderr.write(`  3. Kontrollera att alla artifacts (stämplar, watermarks) hamnar inom synlig yta\n`);
    process.stderr.write(`  4. Visa användaren den faktiska renderingen (Read på PNG)\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`Pixel-nivå verifiering av källfilen räcker INTE för synlighet-compliance.\n\n`);
  } catch (e) {
    // Tysta felet — hook ska aldrig krascha Edit/Write
  }
});