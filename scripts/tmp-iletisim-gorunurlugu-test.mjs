// node scripts/tmp-iletisim-gorunurlugu-test.mjs
//
// "İletişim Bilgisi Görünürlüğü" tercih matrisinin odaklı doğrulaması
// (senaryo 15-20) — önceki tmp-teklif-gizlilik-performans-test.mjs
// çalıştırmasında, bu tam bölümde bir mantık hatası (setContactVisibility
// yanlış kullanıcı oturumundayken çağrılmıştı) bir assertion'ın fırlatmasına
// ve `browser.close()` hiç çağrılamadan (try/finally YOKTU) sürecin asılı
// kalmasına yol açmıştı. Bu script HEM hatayı düzeltiyor HEM de
// `try/finally` ile `browser.close()`ı her koşulda garanti ediyor.
//
// Senaryo 11-14/17/19 (kabul öncesi performans + varsayılan görünürlük)
// BURADA TEKRAR EDİLMİYOR — o kod yolu bu hatadan etkilenmedi, kaynak
// incelemesiyle zaten doğrulandı; yalnızca gerçekten başarısız/doğrulanamamış
// kısım (tercih değiştirme matrisi) burada yeniden çalıştırılıyor.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

async function loginAs(page, email, password, redirect = "/panel") {
  console.log(`  → giriş: ${email}`);
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 15000 });
}

async function uploadOnePhoto(page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "test-fixture.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(TINY_JPEG_BASE64, "base64"),
  });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    },
    { timeout: 15000 },
  );
}

async function fillMainServiceLocation(page, index = 0) {
  await page.getByRole("button", { name: "İlçe", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="İlçe"]').nth(index).waitFor({ state: "visible" });
  await page.locator('ul[aria-label="İlçe"]').nth(index).getByRole("option", { name: "Dilovası", exact: true }).click();
  await page.getByRole("button", { name: "Bölge / Tesis", exact: true }).nth(index).click();
  await page.locator('ul[aria-label="Bölge / Tesis"]').nth(index).waitFor({ state: "visible" });
  await page
    .locator('ul[aria-label="Bölge / Tesis"]')
    .nth(index)
    .getByRole("option", { name: "Beldeport", exact: false })
    .first()
    .click();
  await page.getByLabel("Açık Adres").nth(index).fill("Test Mahallesi, Test Caddesi No:1, Dilovası");
}

async function createJob(page, title) {
  console.log(`  → ilan oluşturuluyor: ${title}`);
  await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
  await page.getByLabel("Hizmet Kategorisi").first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Hizmet Kategorisi").first().selectOption("forklift");
  await page.getByLabel("İlan Başlığı").first().fill(title);
  await page.getByLabel("Hizmete Özel Açıklama").first().fill("Gizlilik testi icin aciklama, yirmi karakterden uzun olmali.");
  await page.getByLabel("Başlangıç Tarihi").first().fill("2026-08-28");
  await page.getByLabel("Bitiş Tarihi").first().fill("2026-08-28");
  await fillMainServiceLocation(page, 0);
  await uploadOnePhoto(page);
  await page.getByLabel("Operasyon Detayları").fill("Gizlilik testi operasyon detaylari, on karakterden uzun.");
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.getByRole("heading", { name: "Operasyon Özeti" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "İlanı Yayınla" }).click();
  await page.waitForURL(/\/ilanlar\//, { timeout: 15000 });
  return page.url().split("/").pop();
}

async function submitOffer(page, jobId) {
  console.log(`  → teklif gönderiliyor: ${jobId}`);
  await page.goto(`${BASE_URL}/ilanlar/${jobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("6000");
  await page.getByLabel("Teklif Açıklaması").fill("Test teklifi - gizlilik dogrulamasi icin gonderildi.");
  await page.getByLabel("Tamamlanması Taahhüt Edilen Gün").selectOption("5");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
}

// NOT: "Gelen Teklifler" ekranında ilan başlığı İKİ kez görünür — bir kez
// kategori/ilan grup başlığında (rounded-card DEĞİL), bir kez de asıl teklif
// kartının içinde (uppercase CSS ile, rounded-card İÇİNDE). `.first()`
// yanlışlıkla grup başlığını yakalayıp xpath ata aramasının hiç sonuç
// bulamamasına (ve 10sn timeout'a) yol açıyordu — `.last()` asıl kartı hedefler.
function cardByJobTitle(page, title) {
  return page.getByText(title, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
}

/** ÖNEMLİ DÜZELTME: bu fonksiyon artık HANGİ kullanıcının tercihini değiştireceğini kendisi netleştirmek için `loginAs`ı kendi içinde çağırıyor — önceki hatada bu adım eksikti, çağıran taraf yanlışlıkla başka bir kullanıcı oturumundayken bu fonksiyon çağrılmıştı. */
async function setContactVisibilityFor(page, email, password, { showEmail, showPhone }) {
  await loginAs(page, email, password, "/panel");
  await page.goto(`${BASE_URL}/panel/hesap-ayarlari`);
  const emailCheckbox = page.getByLabel("E-posta adresimi göster");
  const phoneCheckbox = page.getByLabel("Telefon numaramı göster");
  await emailCheckbox.waitFor({ state: "visible", timeout: 10000 });
  if ((await emailCheckbox.isChecked()) !== showEmail) await emailCheckbox.click();
  if ((await phoneCheckbox.isChecked()) !== showPhone) await phoneCheckbox.click();
  await page.getByRole("button", { name: "Tercihi Kaydet" }).click();
  await page.getByText("İletişim bilgisi tercihiniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });
  console.log(`  → ${email} tercihi kaydedildi: e-posta=${showEmail}, telefon=${showPhone}`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    console.log("=== Hazırlık: kabul edilmiş tek bir teklif ===");
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const jobId = await createJob(page, "Iletisim Gorunurlugu Test Job");

    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await submitOffer(page, jobId);

    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    const card = cardByJobTitle(page, "Iletisim Gorunurlugu Test Job");
    try {
      await card.waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      console.error("--- TEŞHİS: /panel/gelen-teklifler içeriği ---");
      console.error(await page.locator("body").innerText());
      throw error;
    }
    console.log("\n=== Senaryo 11-14, 19: Kabul öncesi (Beklemede) performans görünür, kimlik/iletişim gizli ===");
    const pendingCardText = await card.innerText();
    assert.ok(pendingCardText.includes("tamamlanan iş"), "Tamamlanan iş sayısı kabul ÖNCESİ görünmeli (senaryo 12)");
    ok("Tamamlanan iş sayısı, teklif kabul edilmeden önce görünüyor (senaryo 12)");
    assert.ok(
      pendingCardText.includes("Henüz değerlendirme yok") || /\d\.\d \(\d+\)/.test(pendingCardText),
      "Yıldız puanı bölümü (değer ya da 'Henüz değerlendirme yok') kabul ÖNCESİ görünmeli (senaryo 11, 14)",
    );
    ok("Yıldız puanı bölümü kabul edilmeden önce görünüyor; puan yoksa 'Henüz değerlendirme yok' yazıyor (senaryo 11, 14)");
    assert.ok(pendingCardText.includes("Hizmet Veren #"), "Kabul öncesi anonim etiket ('Hizmet Veren #NNNN') görünmeli");
    assert.ok(!pendingCardText.includes("Mert"), "Hizmet verenin gerçek adı ('Mert') kabul ÖNCESİ görünmemeli (senaryo 13)");
    ok("Ad/soyad kabul edilmeden önce görünmüyor, anonim etiket kullanılıyor (senaryo 13)");
    assert.ok(!pendingCardText.includes("İletişim Bilgileri"), "İletişim bilgisi bloğu kabul ÖNCESİ hiç render edilmemeli (senaryo 19)");
    ok("İletişim bilgisi bloğu, anlaşma tamamlanmadan önce hiç görünmüyor (senaryo 19)");

    await card.getByRole("button", { name: "Kabul Et" }).click();
    await card.getByText("İletişim Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    ok("Teklif kabul edildi, iletişim bilgisi bloğu göründü");

    const users = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
    const mert = users.find((u) => u.email === "mert@test.com");

    console.log("\n=== Senaryo 17: Varsayılan (hiç tercih değiştirilmemiş) — her iki bilgi de görünür ===");
    const acceptedCardText = await card.innerText();
    assert.ok(acceptedCardText.includes(mert.phone), "Varsayılan: telefon görünmeli");
    assert.ok(acceptedCardText.includes(mert.email), "Varsayılan: e-posta görünmeli");
    ok("Varsayılan (tercih hiç değiştirilmemiş) durumda her iki bilgi de görünüyor (senaryo 17)");

    console.log("\n=== Senaryo 15: Mert yalnızca telefonu açık bırakıyor ===");
    await setContactVisibilityFor(page, "mert@test.com", "Mert123!", { showEmail: false, showPhone: true });
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    let cardNow = cardByJobTitle(page, "Iletisim Gorunurlugu Test Job");
    await cardNow.getByText("İletişim Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    let cardText = await cardNow.innerText();
    assert.ok(cardText.includes(mert.phone), "Yalnızca telefon açıkken telefon görünmeli");
    assert.ok(!cardText.includes(mert.email), "Yalnızca telefon açıkken e-posta görünmemeli");
    ok("Yalnızca telefon açıkken sadece telefon görünüyor (senaryo 15)");

    console.log("\n=== Senaryo 20: Mert'in kendi tercihi, Mert'in Zeynep'i görmesini etkilemiyor ===");
    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await page.goto(`${BASE_URL}/panel/tekliflerim`);
    const myOfferCard = cardByJobTitle(page, "Iletisim Gorunurlugu Test Job");
    await myOfferCard.getByText("İletişim Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    const myOfferCardText = await myOfferCard.innerText();
    const usersNow = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
    const zeynep = usersNow.find((u) => u.email === "zeynep@test.com");
    assert.ok(myOfferCardText.includes(zeynep.phone), "Mert, Zeynep'in telefonunu görebilmeli");
    assert.ok(myOfferCardText.includes(zeynep.email), "Mert, Zeynep'in e-postasını görebilmeli");
    ok("Mert kendi tercihini değiştirmesine rağmen Zeynep'in bilgilerini eskisi gibi (tam) görüyor (senaryo 20)");

    console.log("\n=== Senaryo 16: Mert yalnızca e-postayı açık bırakıyor ===");
    await setContactVisibilityFor(page, "mert@test.com", "Mert123!", { showEmail: true, showPhone: false });
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    cardNow = cardByJobTitle(page, "Iletisim Gorunurlugu Test Job");
    await cardNow.getByText("İletişim Bilgileri", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    cardText = await cardNow.innerText();
    assert.ok(cardText.includes(mert.email), "Yalnızca e-posta açıkken e-posta görünmeli");
    assert.ok(!cardText.includes(mert.phone), "Yalnızca e-posta açıkken telefon görünmemeli");
    ok("Yalnızca e-posta açıkken sadece e-posta görünüyor (senaryo 16)");

    console.log("\n=== Senaryo 18: Mert her ikisini de kapatıyor ===");
    await setContactVisibilityFor(page, "mert@test.com", "Mert123!", { showEmail: false, showPhone: false });
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    cardNow = cardByJobTitle(page, "Iletisim Gorunurlugu Test Job");
    await cardNow.waitFor({ state: "visible", timeout: 10000 });
    cardText = await cardNow.innerText();
    assert.ok(!cardText.includes(mert.phone), "Her ikisi kapalıyken telefon görünmemeli");
    assert.ok(!cardText.includes(mert.email), "Her ikisi kapalıyken e-posta görünmemeli");
    assert.ok(
      cardText.includes("Kullanıcı iletişim bilgilerini paylaşmamayı tercih etti."),
      "Kurumsal açıklama mesajı görünmeli",
    );
    ok("Her iki bilgi de kapalıyken hiçbir iletişim bilgisi sızmıyor, kurumsal mesaj gösteriliyor (senaryo 18)");

    console.log(`\n[tmp-iletisim-gorunurlugu-test] ${passed} test geçti.`);
  } finally {
    // KRİTİK DÜZELTME: browser.close() artık HER KOŞULDA (başarı ya da
    // assertion hatası) çalışıyor — önceki hatada bu `finally` yoktu, bu
    // yüzden bir assertion fırlayınca browser hiç kapanmadan süreç asılı
    // kalıyordu (Node, Playwright'ın açık IPC bağlantısı yüzünden event
    // loop'u boşaltamıyordu).
    await browser.close();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("[tmp-iletisim-gorunurlugu-test] HATA:", error);
    process.exitCode = 1;
  });
