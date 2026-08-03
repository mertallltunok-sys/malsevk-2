// Bu iş emrindeki iki düzeltmenin doğrulaması:
//  1. "Bize Ulaşın" ve yasal metin sayfaları (Gizlilik Politikası/Kullanım
//     Koşulları/KVKK) artık modal/dialog/pop-up DEĞİL, gerçek sayfalar;
//     her birinde çalışan bir "Kapat" butonu var (geçmiş varsa geri döner,
//     yoksa ana sayfaya gider); Bize Ulaşın sayfasının üstünde büyük
//     "MALSEVK.com" başlığı yok, tek başlık "Bize Ulaşın".
//  2. "Ürün Cinsi" alanında "Listede Yok, Kendim Gireceğim" seçilince
//     İKİNCİ bir kutu AÇILMIYOR — aynı kutu yerinde manuel yazı alanına
//     dönüşüyor, otomatik odaklanıyor, "Hazır listeden seç" ile geri
//     dönülebiliyor. İlan oluşturma VE düzenleme ekranlarında aynı.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) {
  passed++;
  console.log(`  ok ${d}`);
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}
async function seedJob(page, { id, title, category, productType, reqId }) {
  await page.evaluate(
    ({ id, title, category, productType, reqId }) => {
      const raw = localStorage.getItem("malsevk.jobs.v1");
      const jobs = raw ? JSON.parse(raw) : [];
      jobs.push({
        id, title, category, productType,
        province: "Kocaeli", district: "Gebze", workLocationType: "Test Tesis",
        workDate: "2026-12-01", description: "Urun cinsi kutu testi.", operationDetails: "Test.",
        status: "yayinda", requesterId: reqId, photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, category, productType, reqId },
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    // ---- 1a) Bize Ulaşın: gerçek sayfa, büyük MALSEVK.com başlığı yok ----
    console.log("1) Bize Ulaşın ve yasal sayfalar — gerçek rota + Kapat");
    await page.goto(`${BASE_URL}/`);
    const footerContactLink = page.locator("footer").getByRole("link", { name: "Bize Ulaşın" });
    await footerContactLink.waitFor({ state: "visible" });
    await footerContactLink.click();
    await page.waitForURL(`${BASE_URL}/bize-ulasin`);
    assert.equal(await page.getByRole("dialog").count(), 0, "Bize Ulaşın modal/dialog olarak açılmamalı");
    // "MALSEVK.com" header/footer'da (marka adı olarak, kaldırılması
    // İSTENMEYEN yerlerde) hâlâ görünür — yalnızca sayfanın kendi ANA
    // başlığının (h1) "MALSEVK.com" DEĞİL, "Bize Ulaşın" olduğu kontrol
    // edilir (görev tanımı: "yalnızca iletişim formunun üstündeki büyük
    // başlığı kaldır").
    assert.equal(await page.getByRole("heading", { level: 1, name: "MALSEVK.com" }).count(), 0);
    await page.getByRole("heading", { name: "Bize Ulaşın", level: 1 }).waitFor({ state: "visible" });
    const h1Count = await page.getByRole("heading", { level: 1 }).count();
    assert.equal(h1Count, 1, "sayfada tam olarak tek bir h1 (Bize Ulaşın) olmalı");
    ok("Bize Ulaşın ayrı bir sayfa olarak açılıyor, pop-up yok, tek ana başlık 'Bize Ulaşın' (büyük MALSEVK.com başlığı yok)");

    // Kapat: geçmiş var (footer linkinden geldi) -> ana sayfaya (geldiği yere) döner.
    await page.getByRole("button", { name: "Kapat" }).click();
    await page.waitForURL(`${BASE_URL}/`);
    ok("Kapat butonu, geçmiş varken geldiği sayfaya (ana sayfa) dönüyor");

    // ---- 1b) Yasal sayfalar: aynı desen ----
    for (const [href, title] of [
      ["/gizlilik-politikasi", "Gizlilik Politikası"],
      ["/kullanim-kosullari", "Kullanım Koşulları"],
      ["/kvkk-aydinlatma-metni", "KVKK Aydınlatma Metni"],
    ]) {
      await page.goto(`${BASE_URL}/`);
      const link = page.locator("footer").getByRole("link", { name: title, exact: true });
      await link.click();
      await page.waitForURL(`${BASE_URL}${href}`);
      assert.equal(await page.getByRole("dialog").count(), 0, `${title} modal olarak açılmamalı`);
      await page.getByRole("button", { name: "Kapat" }).waitFor({ state: "visible" });
      ok(`${title} ayrı sayfa olarak açılıyor, çalışan bir Kapat butonu var`);
      await page.getByRole("button", { name: "Kapat" }).click();
      await page.waitForURL(`${BASE_URL}/`);
      ok(`${title}: Kapat geldiği sayfaya (ana sayfa) dönüyor`);
    }

    // ---- 1c) Kapat: geçmiş YOK (doğrudan URL) -> ana sayfaya gider ----
    const freshPage = await browser.newPage();
    await freshPage.goto(`${BASE_URL}/bize-ulasin`);
    await freshPage.getByRole("button", { name: "Kapat" }).click();
    await freshPage.waitForURL(`${BASE_URL}/`);
    ok("Kapat: geçmiş yokken (doğrudan URL) ana sayfaya yönlendiriyor");
    await freshPage.close();

    // ---- 2) Ürün Cinsi: tek kutu, ikinci kutu yok, otomatik odak ----
    console.log("2) Ürün Cinsi manuel alanı — tek kutu, ikinci kutu YOK");

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    const EDIT_JOB = {
      id: "urun-kutu-test-job",
      title: "Urun Kutu Testi Ilani",
      category: "lashing-unlashing",
      productType: "Rulo Sac",
      reqId: zeynepId,
    };
    await seedJob(page, EDIT_JOB);

    async function assertSingleBoxMorph(page) {
      await page.getByLabel("Hizmet Kategorisi").selectOption({ label: "Lashing / Unlashing" }).catch(() => {});
      const combobox = page.getByLabel("Ürün Cinsi");
      await combobox.click();
      await page.getByRole("option", { name: "Listede Yok, Kendim Gireceğim" }).click();

      // Tek kutu: "Ürün Cinsi" etiketiyle TEK input olmalı.
      assert.equal(await page.getByLabel("Ürün Cinsi").count(), 1, "yalnızca tek bir 'Ürün Cinsi' alanı olmalı");
      assert.equal(await page.getByLabel("Ürün Cinsini Yazınız").count(), 0, "ayrı bir 'Ürün Cinsini Yazınız' etiketi/kutusu olmamalı");
      assert.equal(
        await page.getByText("Hazır listeden seçmek için tıklayın").count(),
        0,
        "manuel modda eski açıklama metni görünmemeli",
      );
      ok("Manuel moda geçince ikinci bir kutu açılmıyor, tek 'Ürün Cinsi' alanı kalıyor");

      const manualInput = page.getByLabel("Ürün Cinsi");
      const isFocused = await manualInput.evaluate((el) => el === document.activeElement);
      assert.ok(isFocused, "manuel input açıldığı anda odaklanmalı");
      ok("Manuel input açıldığı anda otomatik odaklanıyor");

      await manualInput.fill("Galvanizli Test Rulo");
      const returnButton = page.getByRole("button", { name: "Hazır listeden seç" });
      await returnButton.waitFor({ state: "visible" });
      await returnButton.click();
      assert.equal(await page.getByLabel("Ürün Cinsini Yazınız").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Hazır listeden seç" }).count(), 0);
      assert.equal(await page.getByLabel("Ürün Cinsi").count(), 1, "hazır listeye dönünce hâlâ tek kutu olmalı");
      ok("'Hazır listeden seç' ile tekrar seçim kutusuna dönülüyor, hâlâ tek kutu var");
    }

    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await assertSingleBoxMorph(page);
    ok("İlan OLUŞTURMA ekranında davranış doğru");

    await page.goto(`${BASE_URL}/panel/hizmet-taleplerim/${EDIT_JOB.id}/duzenle`);
    await assertSingleBoxMorph(page);
    ok("İlan DÜZENLEME ekranında davranış AYNI (ortak component üzerinden)");

    console.log(`\n${passed} kontrol PASSED.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("TEST FAILED:", error);
  process.exit(1);
});
