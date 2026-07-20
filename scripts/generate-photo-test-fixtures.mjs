import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = os.tmpdir();

async function main() {
  // 11 GERÇEKTEN FARKLI (içerik/hash bazında) küçük JPEG — dosya sayısı
  // sınırı testi (TEST 4) mükerrer-dosya tespitiyle karışmasın diye her
  // birinin rengi (dolayısıyla baytları) farklıdır.
  for (let i = 1; i <= 11; i++) {
    const buffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: (i * 23) % 256, g: (i * 61) % 256, b: (i * 97) % 256 },
      },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(dir, `fixture-valid-${i}.jpg`), buffer);
  }

  const oversized = Buffer.alloc(11 * 1024 * 1024, 0x11);
  await writeFile(path.join(dir, "fixture-oversized.jpg"), oversized);

  const fakeImage = Buffer.from("bu bir jpeg degil, sadece duz metin icerik");
  await writeFile(path.join(dir, "fixture-fake.jpg"), fakeImage);

  const fakePdf = Buffer.from("%PDF-1.4\nbu gercek bir pdf degil ama pdf gibi basliyor");
  await writeFile(path.join(dir, "fixture-fake.pdf"), fakePdf);

  console.log("Fixtures oluşturuldu:", dir);
}

main();
