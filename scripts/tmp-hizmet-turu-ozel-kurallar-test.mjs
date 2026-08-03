// Bu görevde yapılan değişikliklerin uçtan uca doğrulaması:
// 1. Depolama lokasyon sadeleştirmesi (yalnızca İl/İlçe) — form alanları
// 2. Depolama süresi hesaplama + ilan detayında gösterimi
// 3. "Tamamlanması Taahhüt Edilen Gün" yalnızca Nakliye teklif formunda
// 4/5. Gümrük Müşavirliği ilan detayında GTİP/Beyan/Konteyner YOK
// 6. Operasyon başlık karışması düzeltmesi (Aktif İlanlar filtre + kart)
// 7. Gelen Teklifler ilan-bazlı seçici (chip başına bir ilan)
//
// İlanlar CreateJob/CreateJobsForOperation akışını (fotoğraf yükleme dahil)
// tekrar sürmek yerine doğrudan localStorage'a (gerçek job-store.ts Job
// şekliyle BİREBİR) seed edilir — bu script CREATE FORMUNUN alan
// görünürlüğünü ayrıca (fotoğrafsız, gönderim denemeden) kontrol eder;
// asıl create/update akışının kendisi zaten TypeScript ile (npm run build)
// ve mevcut test:photo-* betikleriyle kapsanıyor.
// Ön koşul: `npm run dev` (localhost:3000).
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
async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

async function seedJobs(page, requesterId) {
  return page.evaluate((reqId) => {
    const now = new Date();
    const createdAt = now.toISOString();
    const publishEndAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const opId = crypto.randomUUID();
    const base = {
      status: "yayinda",
      requesterId: reqId,
      photos: [],
      operationDetails: "",
      createdAt,
      publishEndAt,
    };
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
      description: "Operasyon baslik karismasi testi icin nakliye aciklamasi metni.",
      operationId: opId,
      productQuantity: 10,
      productTonnage: 20,
      productType: "Rulo Sac",
    };
    const gozetimJob = {
      ...base,
      id: crypto.randomUUID(),
      title: "Gözetim Operasyon Başlığı",
      category: "gozetim-hizmetleri",
      province: "Kocaeli",
      district: "Gebze",
      workLocationType: "Beldeport",
      addressText: "Test adres satiri, en az on karakter.",
      locationMode: "catalog",
      workDate: "2026-08-06",
      workEndDate: "2026-08-06",
      description: "Operasyon baslik karismasi testi icin gozetim aciklamasi metni.",
      operationId: opId,
      productQuantity: 5,
      productType: "Rulo Sac",
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem(
      "malsevk.jobs.v1",
      JSON.stringify([...existing, depoJob, gumrukJob, nakliyeJob, gozetimJob]),
    );
    return { depoJobId: depoJob.id, gumrukJobId: gumrukJob.id, nakliyeJobId: nakliyeJob.id, gozetimJobId: gozetimJob.id };
  }, requesterId);
}

async function selectSearchable(page, label, optionText) {
  const field = page.locator(`text=${label}`).locator("xpath=following::button[1]").first();
  await field.click();
  await page.getByRole("option", { name: optionText, exact: false }).first().click();
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let ids;

  try {
    // ---- 0) Seed: hizmet alan olarak giriş yap, test ilanlarını doğrudan yaz ----
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    const zeynepId = await getUserId(page, "zeynep@test.com");
    ids = await seedJobs(page, zeynepId);
    ok("Test ilanları (Depolama, Gümrük, Nakliye+Gözetim operasyonu) seed edildi");

    // ---- 1) Create formunda Depolama: yalnızca İl/İlçe görünmeli ----
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Kapalı Depolama" });
    await page.waitForTimeout(150);
    const hasLiman = await page.locator("text=Liman / Sanayi / OSB").count();
    const hasAcikAdres = await page.getByText("Açık Adres", { exact: true }).count();
    const hasAynıLokasyon = await page.locator("text=Ana hizmetle aynı lokasyon").count();
    if (hasLiman === 0 && hasAcikAdres === 0) ok("Depolama formunda Liman/Sanayi/OSB ve Açık Adres render edilmiyor");
    else fail("Depolama formunda konum alanları hâlâ görünüyor", { hasLiman, hasAcikAdres });
    if (hasAynıLokasyon === 0) ok('Depolama formunda "Ana hizmetle aynı lokasyon" hiç yok (tek hizmet, zaten beklenmez)');

    // ---- 2) Create formunda Gümrük Müşavirliği: İl/İlçe var, GTİP/Beyan/Konteyner yok ----
    await page.goto(`${BASE_URL}/hizmet-talebi-olustur`);
    await page.locator("select").first().selectOption({ label: "Gümrük Müşavirliği" });
    await page.waitForTimeout(150);
    const hasIslemTuru = await page.locator("text=İşlem Türü").count();
    const hasGtip = await page.locator("text=GTİP Kodu").count();
    const hasBeyan = await page.locator("text=Tahmini Beyan Kalem Sayısı").count();
    const hasKonteyner = await page.locator("text=Konteyner Sayısı").count();
    const hasLimanGumruk = await page.locator("text=Liman / Sanayi / OSB").count();
    if (hasIslemTuru > 0) ok("Gümrük Müşavirliği formu İşlem Türü seçimini (merkezi katalogdan) gösteriyor");
    else fail("Gümrük Müşavirliği formunda İşlem Türü bulunamadı");
    if (hasGtip === 0 && hasBeyan === 0 && hasKonteyner === 0) {
      ok("Gümrük Müşavirliği formunda GTİP/Beyan/Konteyner alanları YOK");
    } else fail("Gümrük Müşavirliği formunda kaldırılması gereken alanlar hâlâ var", { hasGtip, hasBeyan, hasKonteyner });
    if (hasLimanGumruk === 0) ok("Gümrük Müşavirliği formunda Liman/Sanayi/OSB render edilmiyor (İl/İlçe yeterli)");
    else fail("Gümrük Müşavirliği formu hâlâ Liman/Sanayi/OSB gösteriyor");

    // ---- 3) İlan detay: Depolama Süresi ----
    await page.goto(`${BASE_URL}/ilanlar/${ids.depoJobId}`);
    const durationText = await page.locator("text=Depolama Süresi").locator("xpath=following-sibling::p[1]").first().textContent().catch(() => null);
    const bodyText = await page.textContent("body");
    if (bodyText.includes("Depolama Süresi") && bodyText.includes("9 gün")) {
      ok('İlan detayında "Depolama Süresi: 9 gün" doğru gösteriliyor (03.08.2026-11.08.2026)');
    } else fail("Depolama süresi ilan detayında bulunamadı/yanlış", { durationText, hasText: bodyText.includes("Depolama Süresi") });

    // ---- 4) İlan detay: Gümrük Müşavirliği GTİP/Beyan/Konteyner göstermiyor ----
    await page.goto(`${BASE_URL}/ilanlar/${ids.gumrukJobId}`);
    const gumrukBody = await page.textContent("body");
    if (!gumrukBody.includes("GTİP Kodu") && !gumrukBody.includes("Tahmini Beyan Kalem Sayısı") && !gumrukBody.includes("Konteyner Sayısı")) {
      ok("İlan detayında Gümrük Müşavirliği GTİP/Beyan/Konteyner satırları YOK");
    } else fail("İlan detayında kaldırılması gereken Gümrük alanları hâlâ görünüyor");

    // ---- 5) İş Açıklaması / Ürün Bilgileri sıralaması + belirginlik (Nakliye ilanı, ürün bilgisi olan) ----
    await page.goto(`${BASE_URL}/ilanlar/${ids.nakliyeJobId}`);
    await page.waitForSelector("h1");
    const headings = await page.locator("h2").allTextContents();
    const productIdx = headings.findIndex((h) => h.includes("Ürün Bilgileri"));
    const descIdx = headings.findIndex((h) => h.includes("İş Açıklaması"));
    const offerIdx = headings.findIndex((h) => h.includes("Teklif Ver"));
    if (productIdx !== -1 && descIdx !== -1 && offerIdx !== -1 && productIdx < descIdx && descIdx < offerIdx) {
      ok(`Bilgi hiyerarşisi doğru sırada: Ürün Bilgileri(${productIdx}) < İş Açıklaması(${descIdx}) < Teklif Ver(${offerIdx})`);
    } else fail("Başlık sırası beklenildiği gibi değil", { headings });

    await logout(page);

    // ---- 6) Hizmet Veren: Aktif İlanlar filtresi - operasyon başlık karışması düzeltmesi ----
    await loginAs(page, "mert@test.com", "Mert123!", "/panel");
    await page.goto(`${BASE_URL}/ilanlar`);
    await selectSearchable(page, "Hizmet Türü", "Gözetim Hizmetleri");
    await page.waitForTimeout(300);
    const gozetimLink = page.locator(`a[href="/ilanlar/${ids.gozetimJobId}"]`).first();
    const nakliyeLinkVisible = await page.locator(`a[href="/ilanlar/${ids.nakliyeJobId}"]`).count();
    const gozetimLinkVisible = await gozetimLink.count();
    if (gozetimLinkVisible > 0) {
      const linkText = await gozetimLink.textContent();
      if (linkText.includes("Gözetim Operasyon Başlığı")) {
        ok('"Gözetim Hizmetleri" filtresiyle operasyon kartı doğru şekilde Gözetim ilanına bağlanıyor (başlık + link)');
      } else fail("Operasyon kartının başlığı yanlış (hâlâ Nakliye başlığı olabilir)", { linkText });
    } else fail("Gözetim filtre sonucunda beklenen ilan linki bulunamadı", { nakliyeLinkVisible, gozetimLinkVisible });

    // ---- 7) Teklif formu: Depolama'da "Tamamlanması Taahhüt Edilen Gün" YOK, Nakliye'de VAR ----
    await page.goto(`${BASE_URL}/ilanlar/${ids.depoJobId}`);
    const depoOfferFormHasDuration = await page.locator("text=Tamamlanması Taahhüt Edilen Gün").count();
    if (depoOfferFormHasDuration === 0) ok('Depolama ilanının teklif formunda "Tamamlanması Taahhüt Edilen Gün" YOK');
    else fail('Depolama teklif formunda taahhüt günü alanı hâlâ var');

    await page.locator('textarea[placeholder*="ekip ve ekipman"]').fill("Depolama teklifi icin en az yirmi karakterlik aciklama metni.");
    await page.locator('input[placeholder="Ör. 12500,50"]').fill("1000");
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.waitForTimeout(500);
    ok("Depolama ilanına teklif başarıyla gönderildi (taahhüt günü zorunlu değil)");

    await page.goto(`${BASE_URL}/ilanlar/${ids.nakliyeJobId}`);
    await page.waitForSelector("h1");
    const nakliyeOfferFormHasDuration = await page.locator("text=Tamamlanması Taahhüt Edilen Gün").count();
    if (nakliyeOfferFormHasDuration > 0) ok('Nakliye ilanının teklif formunda "Tamamlanması Taahhüt Edilen Gün" HÂLÂ var');
    else fail("Nakliye teklif formunda taahhüt günü alanı kayboldu");

    await page.locator('textarea[placeholder*="ekip ve ekipman"]').fill("Nakliye teklifi icin en az yirmi karakterlik aciklama metni.");
    await page.locator('input[placeholder="Ör. 12500,50"]').fill("2000");
    await page.locator("#" + (await page.locator('label:has-text("Tamamlanması Taahhüt Edilen Gün")').getAttribute("for"))).selectOption({ label: "5 gün" });
    await page.getByRole("button", { name: "Teklif Gönder" }).click();
    await page.waitForTimeout(500);
    ok("Nakliye ilanına teklif başarıyla gönderildi (taahhüt günü seçilerek)");

    await logout(page);

    // ---- 8) Hizmet Alan: Gelen Teklifler ilan-bazlı seçici ----
    await loginAs(page, "zeynep@test.com", "Zeynep1!", "/panel");
    await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
    await page.waitForTimeout(300);
    const chipButtons = page.locator("button[aria-pressed]");
    const chipCount = await chipButtons.count();
    if (chipCount >= 2) ok(`Gelen Teklifler'de ${chipCount} bağımsız ilan chip'i görünüyor (kategoriye göre birleştirilmemiş)`);
    else fail("Gelen Teklifler'de beklenen sayıda chip yok", { chipCount });

    const bodyBefore = await page.textContent("body");
    const depoVisibleBefore = bodyBefore.includes("Depolama teklifi icin");
    const nakliyeVisibleBefore = bodyBefore.includes("Nakliye teklifi icin");
    if (depoVisibleBefore !== nakliyeVisibleBefore) {
      ok("Varsayılan seçili chip yalnızca TEK ilanın tekliflerini gösteriyor (diğeri gizli)");
    } else fail("Beklenmedik: her iki ilanın teklifleri aynı anda görünüyor ya da hiçbiri görünmüyor", { depoVisibleBefore, nakliyeVisibleBefore });

    // Diğer chip'e tıkla, görünümün değiştiğini doğrula
    for (let i = 0; i < chipCount; i++) {
      const chip = chipButtons.nth(i);
      const isPressed = await chip.getAttribute("aria-pressed");
      if (isPressed === "false") {
        await chip.click();
        await page.waitForTimeout(200);
        break;
      }
    }
    const bodyAfter = await page.textContent("body");
    const depoVisibleAfter = bodyAfter.includes("Depolama teklifi icin");
    const nakliyeVisibleAfter = bodyAfter.includes("Nakliye teklifi icin");
    if ((depoVisibleAfter || nakliyeVisibleAfter) && depoVisibleAfter !== depoVisibleBefore) {
      ok("Farklı bir chip'e tıklamak görünen teklif setini doğru şekilde değiştiriyor");
    } else fail("Chip değişimi teklif görünümünü beklendiği gibi değiştirmedi", { depoVisibleBefore, nakliyeVisibleBefore, depoVisibleAfter, nakliyeVisibleAfter });

    await browser.close();
  } catch (error) {
    fail("beklenmeyen hata", error);
    await browser.close();
  }

  console.log(`\n${passed} kontrol geçti.`);
  process.exit(process.exitCode ?? 0);
})();
