// node scripts/tmp-header-logo-test.mjs
//
// Header'a eklenen gerçek MALSEVK logosunun (public/logo/malsevk-logo.svg,
// site-header.tsx) doğru göründüğünü doğrular: misafir + her iki rol,
// masaüstü + mobil, header yüksekliği (h-16 = 64px) sabit kalıyor mu,
// logo gerçekten yükleniyor mu (naturalWidth > 0), tek Home linki ve
// "MALSEVK.com" metninin (".com" dahil, hiçbir viewport'ta kaybolmadan)
// tam olarak, TEK bir metin parçası olarak (MALSEVK ile aynı boyut/
// kalınlık/renk) göründüğü doğru mu. Ayrıca logo yüksekliği (~26-30px
// mobil / ~30-34px masaüstü, en-boy oranı korunmuş), logo↔yazı boşluğu
// (~8px) ve marka yazı boyutu (~20px mobil / ~24px masaüstü) ölçülüp
// doğrulanır. Ön koşul: `npm run dev` çalışıyor olmalı.

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;

function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

async function checkHeaderLogo(page, label) {
  const link = page.locator('header a[href="/"]').first();
  await assert.doesNotReject(link.waitFor({ state: "visible", timeout: 10000 }));

  const img = link.locator("img");
  await assert.doesNotReject(img.waitFor({ state: "visible", timeout: 10000 }));

  assert.equal(await img.getAttribute("alt"), "MALSEVK");
  const src = await img.getAttribute("src");
  assert.ok(src && src.includes("malsevk-logo.svg"), `beklenmeyen logo src: ${src}`);

  const naturalWidth = await img.evaluate((el) => el.naturalWidth);
  assert.ok(naturalWidth > 0, "logo <img> yüklenmemiş (naturalWidth === 0)");

  const text = (await link.innerText()).trim();
  assert.equal(text, "MALSEVK.com");

  // ".com" görünürlüğü ayrıca element bazında da doğrulanır — sadece innerText
  // birleşimine değil, gerçek DOM metnine ve görünürlüğüne (display/visibility/
  // clip/overflow ile gizlenmediğine) bakılır. Marka metni artık TEK bir düz
  // metin parçası (iç içe <span> yok) — "MALSEVK" ve ".com" ayrı stillere
  // sahip değil, ikisi de aynı elementin computed style'ını paylaşıyor.
  const brandSpan = link.locator("span").first();
  const brandText = (await brandSpan.innerText()).trim();
  assert.equal(brandText, "MALSEVK.com");
  assert.ok(await brandSpan.isVisible(), "MALSEVK.com metni görünür değil");
  const nestedSpanCount = await brandSpan.evaluate((el) => el.querySelectorAll("span").length);
  assert.equal(nestedSpanCount, 0, "marka metni hâlâ iç içe <span> içeriyor — MALSEVK ve .com ayrı stillenmiş olabilir");
  const overflowInfo = await brandSpan.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, width: rect.width };
  });
  assert.ok(
    overflowInfo.width >= overflowInfo.scrollWidth - 1,
    `"MALSEVK.com" metni kırpılmış olabilir: ${JSON.stringify(overflowInfo)}`,
  );

  // Kesin ölçümler: logo yüksekliği (aralık: mobil 26-30px / masaüstü
  // 30-34px), en-boy oranı (esnetme/sıkışma yok), logo↔yazı boşluğu (~8px)
  // ve marka yazı boyutu — viewport'a göre (sm: 640px kırılımı).
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const isDesktop = viewportWidth >= 640;
  const logoRange = isDesktop ? [30, 34] : [26, 30];
  const expectedFontPx = isDesktop ? 24 : 20;

  const logoNaturalRatio = await img.evaluate((el) => el.naturalWidth / el.naturalHeight);
  const logoBox = await img.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  assert.ok(
    logoBox.height >= logoRange[0] - 0.5 && logoBox.height <= logoRange[1] + 0.5,
    `logo yüksekliği beklenen aralıkta değil (beklenen ${logoRange[0]}-${logoRange[1]}px, ölçülen ${logoBox.height}px)`,
  );
  const expectedWidth = logoBox.height * logoNaturalRatio;
  assert.ok(
    Math.abs(logoBox.width - expectedWidth) <= 1,
    `logo en-boy oranı bozulmuş (esnetilmiş/sıkışmış/kırpılmış olabilir): ${JSON.stringify({ ...logoBox, expectedWidth, logoNaturalRatio })}`,
  );

  const brandBox = await brandSpan.evaluate((el) => el.getBoundingClientRect());
  const gapPx = brandBox.left - (logoBox.left + logoBox.width);
  assert.ok(Math.abs(gapPx - 8) <= 1.5, `logo↔yazı boşluğu ~8px değil, ölçülen: ${gapPx.toFixed(1)}px`);
  assert.ok(
    Math.abs(logoBox.top + logoBox.height / 2 - (brandBox.top + brandBox.height / 2)) <= 2,
    "logo ve yazı dikey olarak tam ortalanmamış",
  );

  const fontInfo = await brandSpan.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      fontSize: parseFloat(style.fontSize),
      fontWeight: parseInt(style.fontWeight, 10),
      color: style.color,
      opacity: style.opacity,
    };
  });
  assert.ok(
    Math.abs(fontInfo.fontSize - expectedFontPx) <= 1,
    `marka yazı boyutu beklenenden farklı (beklenen ~${expectedFontPx}px, ölçülen ${fontInfo.fontSize}px)`,
  );
  assert.ok(fontInfo.fontWeight >= 700, `"MALSEVK.com" yeterince kalın değil (font-weight: ${fontInfo.fontWeight})`);

  // Ölçüm h-16'nın uygulandığı iç satır üzerinden yapılır — dış <header>'ın
  // kendisi border-b nedeniyle 1px daha yüksek (65px) rapor eder, bu logo
  // değişikliğinden bağımsız, önceden de var olan bir davranıştır.
  const contentRowHeight = await page.evaluate(() => {
    const row = document.querySelector("header > div");
    return row ? row.getBoundingClientRect().height : null;
  });
  assert.equal(contentRowHeight, 64, `header içerik satırı (h-16) 64px değil: ${contentRowHeight}`);

  ok(
    `[${label}] logo ${logoBox.height.toFixed(0)}x${logoBox.width.toFixed(0)}px, boşluk ${gapPx.toFixed(0)}px, yazı ${fontInfo.fontSize.toFixed(0)}px/weight:${fontInfo.fontWeight} (tek parça), dikey ortalı, "MALSEVK.com" tam, header 64px`,
  );
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  // 1) Misafir kullanıcı, masaüstü
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/`);
  await checkHeaderLogo(page, "misafir / masaüstü / 1280px");

  // 2) Misafir kullanıcı, mobil
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await checkHeaderLogo(page, "misafir / mobil / 390px");

  // 2b) En dar yaygın mobil genişlik (320px, iPhone SE 1. nesil) — ".com"un
  // en sıkışık durumda bile kaybolmadığını/kırpılmadığını doğrular.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await checkHeaderLogo(page, "misafir / mobil (en dar) / 320px");

  // 3) Hizmet Alan (Zeynep) girişi, masaüstü + mobil
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill("zeynep@test.com");
  await page.locator('input[type="password"]').fill("Zeynep1!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
  await checkHeaderLogo(page, "Hizmet Alan (Zeynep) / masaüstü / 1280px");

  await page.goto(`${BASE_URL}/panel`);
  await checkHeaderLogo(page, "Hizmet Alan (Zeynep) / panel / masaüstü");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await checkHeaderLogo(page, "Hizmet Alan (Zeynep) / panel / mobil / 390px");

  // 4) Çıkış yap, Hizmet Veren (Mert) girişi, masaüstü + mobil
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${BASE_URL}/giris-yap`);
  await page.locator('input[type="email"]').fill("mert@test.com");
  await page.locator('input[type="password"]').fill("Mert123!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
  await checkHeaderLogo(page, "Hizmet Veren (Mert) / masaüstü / 1280px");

  await page.goto(`${BASE_URL}/ilanlar`);
  await checkHeaderLogo(page, "Hizmet Veren (Mert) / ilanlar (Aktif İlanlar) / masaüstü");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await checkHeaderLogo(page, "Hizmet Veren (Mert) / ilanlar / mobil / 390px");

  if (consoleErrors.length > 0) {
    console.log("\n[tmp-header-logo-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
    process.exitCode = 1;
  } else {
    console.log("\n[tmp-header-logo-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  await browser.close();
  console.log(`\n[tmp-header-logo-test] ${passed}/${passed} test geçti.`);
}

main().catch((error) => {
  console.error("[tmp-header-logo-test] HATA:", error);
  process.exitCode = 1;
});
