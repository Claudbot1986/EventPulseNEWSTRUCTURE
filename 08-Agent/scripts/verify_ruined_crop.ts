import sharp from 'sharp';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL!;
  const files = ['-.png', '-cirkus.png', '10cc-konsertsalen.png'];
  for (const f of files) {
    const srcUrl = `${url}/storage/v1/object/public/event-posters/ai-stamped/${f}`;
    const res = await fetch(srcUrl);
    if (!res.ok) { console.log(`miss ${f}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    // Hela botten-bandet y=720..820 (100 px)
    await sharp(buf)
      .extract({ left: 0, top: 720, width: 1024, height: 100 })
      .png()
      .toFile(`/tmp/ruined-${f.replace(/[^a-z0-9.-]/gi, '_').slice(0, 30)}.png`);
    console.log(`  /tmp/ruined-${f.slice(0, 20)}.png`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
