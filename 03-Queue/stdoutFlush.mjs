/**
 * stdoutFlush.mjs — flusha stdout innan process.exit().
 *
 * VARFÖR (2026-10-28). `process.exit()` avslutar omedelbart och kastar det
 * som ligger i skrivbufferten. På macOS är skrivning till en PIPE asynkron —
 * och det är ett PIPE som kedjan lyssnar på (`proc.stdout.on('data')` i
 * scripts/ingestion-cron.ts).
 *
 * Mätt på den här maskinen (macOS, Node 25):
 *
 *   200 000 rader genom en långsam läsare  →  1 708 rader
 *   20 MB genom en långsam läsare            →  exakt 65 536 byte
 *
 * 65 536 är pipens buffert. Allt som inte ryms kastas när processen avslutar.
 * Den sista raden dräneringen skriver — `[drain] avslutar (…): completed=N
 * failed=M` — är just den rad kedjan parsar för att veta om dräneringen
 * lyckades. Tappar vi den blir `worker-drain` omätbar (`eventsExtracted:
 * null`), och kedjan kan rapportera "grön" på importens siffra ensam.
 *
 * LÖSNINGEN. Skriv en tom sträng och vänta på dess callback. Node behandlar
 * skrivningar i ordning, så callbacken kommer först när allt som stod före
 * i kön är ute ur processen. En timeout skyddar mot en trasig ström.
 *
 * Modulen är beroendefri (ingen Redis, ingen importkö) så att regeln kan
 * testas utan infrastruktur — samma princip som 03-Queue/drainOutcome.mjs.
 */

/** Hur länge vi väntar på en trasig ström innan vi ger upp och avslutar. */
export const STDOUT_FLUSH_TIMEOUT_MS = 5_000;

/**
 * Vänta tills allt som står i strömmens skrivkö är ute.
 *
 * @param {NodeJS.WritableStream} [stream] vilken ström som ska tömmas
 * @param {number} [timeoutMs] gräns för en trasig ström
 * @returns {Promise<void>}
 */
export async function flushStdout(stream = process.stdout, timeoutMs = STDOUT_FLUSH_TIMEOUT_MS) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    try {
      // Tom sträng = inget nytt innehåll, men en skrivning som står i kön
      // EFTER allt som redan skrivits.
      stream.write('', () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}
