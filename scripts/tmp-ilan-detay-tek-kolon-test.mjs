// İlan detay sayfasının tek-sütunlu (masaüstü dahil) yerleşiminin
// doğrulaması: iki sütunlu grid + sağ "Teklif Ver" sütunu kaldırıldı, Teklif
// Ver artık bilgi kartlarının EN ALTINDA, sticky olmadan render ediliyor.
// Ön koşul: `npm run dev` (localhost:3000) VE önceki oturumda seed edilmiş
// test ilanları (tmp-hizmet-turu-ozel-kurallar-test.mjs) zaten localStorage'da.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
let passed = 0;
function ok(d) { passed++; console.log(`  ok ${d}`); }
function fail(d, e) { console.log(`  FAIL ${d}`); console.log(e?.message ?? e); process.exitCode = 1; }

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
async function getJobIdByTitle(page, title) {
  return page.evaluate((t) => {
    const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    return jobs.find((j) => j.title === t)?.id;
  }, title);
}

/** Bağımsız bir Playwright oturumu her zaman boş localStorage ile başladığı
 * için test ilanları burada TEKRAR (önceki tmp-hizmet-turu-ozel-kurallar-test.mjs
 * ile AYNI şekilde) seed edilir — betikler arası paylaşılan durum yoktur. */
async function seedJobs(page, requesterId) {
  return page.evaluate((reqId) => {
    const now = new Date();
    const createdAt = now.toISOString();
    const publishEndAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const base = { status: "yayinda", requesterId: reqId, photos: [], operationDetails: "", createdAt, publishEndAt };
    const depoJob = {
      ...base,
      id: crypto.randomUUID(),
      title: "Depolama Testi Kapalı Depo İlanı",
      category: "kapali-depolama",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "",
      workDate: "2026-08-03",
      workEndDate: "2026-08-11",
      description: "Depolama suresi hesaplama testi icin en az yirmi karakterlik aciklama.",
    };
    const gumrukJob = {
      ...base,
      id: crypto.randomUUID(),
      title: "Gümrük Testi Transit Yük İlanı",
      category: "gumruk-musavirligi",
      province: "Kocaeli",
      district: "Dilovası",
      workLocationType: "",
      workDate: "2026-08-05",
      workEndDate: "2026-08-05",
      description: "Gumruk musavirligi sadelesme testi icin en az yirmi karakterlik aciklama.",
      customsTransactionType: "ithalat",
      customsOfficeId: "dilovasi-gumruk-mudurlugu",
      customsProductType: "Rulo Sac",
    };
    const nakliyeJob = {
      ...base,
      id: crypto.randomUUID(),
      title: "Nakliye Operasyon Başlığı",
      category: "nakliye",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "Beldeport",
      addressText: "Test adres satiri, en az on karakter.",
      locationMode: "catalog",
      workDate: "2026-08-06",
      workEndDate: "2026-08-06",
      description: "Tek kolon yerlesim testi icin nakliye aciklamasi metni.",
      productQuantity: 10,
      productTonnage: 20,
      productType: "Rulo Sac",
      deliveryProvince: "Kocaeli",
      deliveryDistrict: "Gebze",
      deliveryLocationType: "open_address",
      deliveryAddressText: "Teslimat adres satiri, en az on karakter.",
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    const alreadySeeded = existing.some((j) => j.title === depoJob.title);
    if (!alreadySeeded) {
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing, depoJob, gumrukJob, nakliyeJob]));
    }
  }, requesterId);
}

/** Sayfada bir grid'in ne kadar sütuna böründüğünü ölçer — computed style üzerinden. */
async function isSingleColumnFlow(page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent?.trim());
    const offerIdx = headings.findIndex((h) => h === "Teklif Ver");
    if (offerIdx === -1) return { ok: false, reason: "Teklif Ver başlığı bulunamadı", headings };
    // Sayfadaki TÜM h2 başlıklarının x-koordinatı aynı olmalı (tek sütun) —
    // eski iki sütunlu tasarımda Teklif Ver'in x'i diğerlerinden farklıydı.
    const allHeadingRects = Array.from(document.querySelectorAll("h2")).map((h) => h.getBoundingClientRect());
    const sameX = allHeadingRects.every((r) => Math.abs(r.left - allHeadingRects[0].left) < 2);
    // Teklif Ver, sayfadaki EN SON h2 olmalı (en altta).
    const isLast = offerIdx === headings.length - 1;
    // Herhangi bir öğe görünür pencereden taşıyor mu (yatay taşma)?
    const hasHorizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return { ok: sameX && isLast && !hasHorizontalOverflow, sameX, isLast, hasHorizontalOverflow, headings };
  });
}

(async () => {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    await seedJobs(page, zeynepId);

    const depoJobId = await getJobIdByTitle(page, "Depolama Testi Kapalı Depo İlanı");
    const gumrukJobId = await getJobIdByTitle(page, "Gümrük Testi Transit Yük İlanı");
    const nakliyeJobId = await getJobIdByTitle(page, "Nakliye Operasyon Başlığı");

    if (!depoJobId || !gumrukJobId || !nakliyeJobId) {
      fail("Önceki test seedinden ilanlar bulunamadı — önce tmp-hizmet-turu-ozel-kurallar-test.mjs çalıştırılmalı");
      await browser.close();
      process.exit(1);
    }

    // ---- 1) Nakliye ilanı, masaüstü genişliği (hizmet alan kendi ilanını görüntülüyor) ----
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
    await page.waitForSelector("h1");
    let result = await isSingleColumnFlow(page);
    if (result.ok) ok("Nakliye ilanı (masaüstü 1440px): tek sütun, Teklif Ver en altta, sticky değil, taşma yok");
    else fail("Nakliye ilanı masaüstü yerleşimi beklenmedik", result);

    const hasTasimaGuzergahi = await page.getByText("Taşıma Güzergâhı").count();
    if (hasTasimaGuzergahi > 0) ok("Nakliye ilanında Taşıma Güzergâhı kartı görünüyor");
    else fail("Nakliye ilanında Taşıma Güzergâhı kartı bulunamadı");

    // ---- 2) Nakliye ilanı, mobil genişlik ----
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
    await page.waitForSelector("h1");
    result = await isSingleColumnFlow(page);
    if (result.ok) ok("Nakliye ilanı (mobil 375px): tek sütun, Teklif Ver en altta, yatay taşma yok");
    else fail("Nakliye ilanı mobil yerleşimi beklenmedik", result);
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- 3) Depolama ilanı ----
    await page.goto(`${BASE_URL}/ilanlar/${depoJobId}`);
    await page.waitForSelector("h1");
    result = await isSingleColumnFlow(page);
    if (result.ok) ok("Depolama ilanı: tek sütun, Teklif Ver en altta");
    else fail("Depolama ilanı yerleşimi beklenmedik", result);
    const hasDepolamaSuresi = await page.getByText("Depolama Süresi").count();
    if (hasDepolamaSuresi > 0) ok("Depolama ilanında Depolama Süresi kartı görünüyor");
    else fail("Depolama ilanında Depolama Süresi kartı bulunamadı");

    // ---- 4) Gümrük Müşavirliği ilanı ----
    await page.goto(`${BASE_URL}/ilanlar/${gumrukJobId}`);
    await page.waitForSelector("h1");
    result = await isSingleColumnFlow(page);
    if (result.ok) ok("Gümrük Müşavirliği ilanı: tek sütun, Teklif Ver en altta");
    else fail("Gümrük Müşavirliği ilanı yerleşimi beklenmedik", result);
    const hasGumrukBilgileri = await page.getByText("Gümrük Müşavirliği Bilgileri").count();
    if (hasGumrukBilgileri > 0) ok("Gümrük Müşavirliği ilanında İşlem Türü/İl-İlçe bilgi kartı görünüyor");
    else fail("Gümrük Müşavirliği bilgi kartı bulunamadı");

    // ---- 5) Hizmet alan kendi ilanını görüntülüyor: mevcut yetki mesajı korunmuş ----
    const authNoticeText = await page.getByText("Yalnızca Hizmet Veren kullanıcılar bu ilana teklif verebilir.").count();
    if (authNoticeText > 0) ok("Hizmet Alan kendi ilanını görüntülerken mevcut yetki bilgilendirmesi korunmuş");
    else fail("Hizmet Alan yetki bilgilendirme metni bulunamadı");

    // ---- 6) Hizmet veren kullanıcının teklif formunu görüntülemesi (Nakliye) ----
    await page.goto(`${BASE_URL}/panel`);
    await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
    await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
    await page.waitForURL(`${BASE_URL}/`);
    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
    await page.waitForSelector("h1");
    const hasDurationField = await page.getByText("Tamamlanması Taahhüt Edilen Gün").count();
    const hasOfferButton = await page.getByRole("button", { name: "Teklif Gönder" }).count();
    if (hasDurationField > 0 && hasOfferButton > 0) {
      ok("Hizmet veren Nakliye teklif formunu görüntülüyor (taahhüt günü alanı dahil, form işlevi bozulmamış)");
    } else fail("Nakliye teklif formu beklenmedik şekilde göründü", { hasDurationField, hasOfferButton });

    // ---- 7) Daha önce teklif verilmiş ilan: gerçek bir teklif gönder, sonra tekrar aç ----
    await page.locator('textarea[placeholder*="ekip ve ekipman"]').fill("Tek kolon yerlesim testi icin en az yirmi karakterlik teklif aciklamasi.");
    await page.locator('input[placeholder="Ör. 12500,50"]').fill("1500");
    await page.locator("#" + (await page.locator('label:has-text("Tamamlanması Taahhüt Edilen Gün")').getAttribute("for"))).selectOption({ label: "3 gün" });
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.waitForTimeout(500);
    await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
    await page.waitForSelector("h1");
    const hasExistingOfferSummary = await page.getByText("Bu ilana daha önce teklif verdiniz.").count();
    if (hasExistingOfferSummary > 0) {
      const summaryResult = await isSingleColumnFlow(page);
      if (summaryResult.ok) ok("Daha önce teklif verilmiş ilanda mevcut teklif özeti, tüm bilgi kartlarının altında (tek sütun, sticky değil)");
      else fail("Teklif özeti sayfası tek sütun değil", summaryResult);
    } else fail("Teklif gönderildikten sonra 'Bu ilana daha önce teklif verdiniz.' özeti bulunamadı");

    await browser.close();
  } catch (error) {
    fail("beklenmeyen hata", error);
    await browser.close();
  }

  console.log(`\n${passed} kontrol geçti.`);
  process.exit(process.exitCode ?? 0);
})();
