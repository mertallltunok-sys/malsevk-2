// Aşama 2.1 (Hizmet Kategorilerini Tek Merkezde Birleştirme) doğrulaması:
// - İlan oluşturma formunun Kategori seçimi artık merkezi katalogdan
//   (service-catalog.ts#SERVICE_CATEGORY_GROUPS) geliyor, gruplu (optgroup).
// - Yeni ilan oluşturma id tabanlı kategoriyle çalışıyor; ilan kartı/detayı
//   doğru Türkçe etiketi gösteriyor.
// - Eski, düz metin kategori taşıyan (statik örnek) ilanlar hâlâ doğru
//   görüntüleniyor (safe display resolver).
// - ProviderProfile.expertise (eski) → serviceCategories (yeni) migrasyonu:
//   eşleşen değerler otomatik işaretli geliyor, eşleşmeyen değer ("Depolama")
//   sessizce kaybolmuyor (orijinal expertise dizisinde kalıyor).
// - Migrasyon tekrar tekrar açılıp kapatıldığında çoğaltma oluşturmuyor.
// - Demo hesaplar bozulmadı.
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE_URL = "http://localhost:3000";
const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const FIXTURE = path.join(os.tmpdir(), "fixture-valid-1.jpg");

let anyFail = false;
function check(label, passed, detail) {
  if (!passed) anyFail = true;
  console.log(`    [${passed ? "OK  " : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function login(page, account, redirect = "/panel") {
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`);
}

async function checkNoHorizontalOverflow(page, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  check(`${label}: yatay taşma yok`, scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    attachDiagnostics(page);

    // ============ 1) İlan oluşturma: kategori seçenekleri merkezi katalogdan ============
    console.log("\n=== İlan oluşturma formu: Kategori merkezi katalogdan geliyor ===");
    await login(page, ZEYNEP, "/hizmet-talebi-olustur");
    const categorySelect = page.getByLabel("Hizmet Kategorisi");
    const optgroupLabels = await categorySelect.locator("optgroup").evaluateAll((els) => els.map((el) => el.label));
    check(
      "5 grup (optgroup) görünüyor",
      optgroupLabels.length === 5,
      `bulunan: ${optgroupLabels.join(", ")}`,
    );
    check(
      "'Liman Hizmetleri' grubu var",
      optgroupLabels.includes("Liman Hizmetleri"),
    );
    check(
      "'Operatör Hizmetleri' grubu var",
      optgroupLabels.includes("Operatör Hizmetleri"),
    );
    const optionValues = await categorySelect.locator("option").evaluateAll((els) => els.map((el) => el.value));
    check("Yeni id 'lashing' seçenek olarak var", optionValues.includes("lashing"));
    check("Yeni id 'forklift-operatoru' seçenek olarak var", optionValues.includes("forklift-operatoru"));
    check(
      "Eski düz 'Yükleme / Boşaltma Gözetimi' değeri ARTIK seçenek DEĞİL",
      !optionValues.includes("Yükleme / Boşaltma Gözetimi"),
    );
    check("Kategori adımı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 2) Yeni ilan oluşturma (id tabanlı kategoriyle) ============
    console.log("\n=== Yeni ilan oluşturuluyor (Forklift Operatörü, id tabanlı) ===");
    await categorySelect.selectOption({ label: "Forklift Operatörü" });
    await page.getByLabel("İş Tarihi").fill("2026-09-20");
    await page.getByLabel("İlan Başlığı").fill(`Katalog Testi İlanı ${Date.now()}`);
    await page
      .getByLabel("İş Açıklaması")
      .fill("Merkezi hizmet kataloğu doğrulaması için oluşturulan otomatik test ilanı.");

    await page.getByRole("button", { name: "İl", exact: true }).click();
    await page.locator('ul[aria-label="İl"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İl"]').getByRole("option", { name: "Kocaeli", exact: true }).click();

    await page.getByRole("button", { name: "İlçe", exact: true }).click();
    await page.locator('ul[aria-label="İlçe"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="İlçe"]').getByRole("option", { name: "Dilovası", exact: true }).click();

    await page.getByLabel("İşin Yapılacağı Yer Türü").selectOption({ label: "Liman" });
    await page.getByRole("button", { name: "Tesis", exact: true }).click();
    await page.locator('ul[aria-label="Tesis"]').waitFor({ state: "visible" });
    await page.locator('ul[aria-label="Tesis"]').getByRole("option", { name: "Beldeport" }).click();

    await page.getByLabel("Operasyon Detayları").fill("Otomatik test için operasyon detayları.");
    await page.setInputFiles('input[type="file"]', [FIXTURE]);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label$="fotoğrafını sil"]').length === 1 &&
        document.querySelectorAll(".animate-spin").length === 0,
      { timeout: 20000 },
    );
    await page.getByRole("button", { name: "İlanı Yayınla" }).click();
    await page.waitForURL(/\/ilanlar\/.+/, { timeout: 15000 });
    check("Yeni ilan başarıyla oluşturuldu", /\/ilanlar\/.+/.test(page.url()));
    check(
      "Yeni ilan detay sayfasında 'Forklift Operatörü' etiketi (id'den çözümlenmiş) görünüyor",
      await page.getByText("Forklift Operatörü", { exact: true }).first().isVisible(),
    );

    const newJobId = page.url().split("/ilanlar/")[1];
    const storedCategory = await page.evaluate((jobId) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      return jobs.find((j) => j.id === jobId)?.category;
    }, newJobId);
    check("localStorage'da kategori ID olarak saklanmış ('forklift-operatoru')", storedCategory === "forklift-operatoru");
    check("İlan oluşturma: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 3) Mevcut (statik örnek) ilanlar hâlâ doğru görüntüleniyor ============
    console.log("\n=== Mevcut ilanlar (eski düz kategori metniyle) hâlâ görüntülenebiliyor ===");
    await page.goto(`${BASE_URL}/ilanlar`);
    await page.waitForTimeout(300);
    check(
      "Eski, katalogda karşılığı olmayan 'Depolama' kategorisi hâlâ doğru gösteriliyor (veri kaybı yok)",
      await page.getByText("Depolama", { exact: true }).first().isVisible().catch(() => false),
    );
    check("İlanlar listesi: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
    await checkNoHorizontalOverflow(page, "İlanlar listesi (1280px)");

    // ============ 4) expertise -> serviceCategories migrasyonu ============
    console.log("\n=== Eski 'expertise' verisi olan Hizmet Veren: migrasyon ===");
    await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await login(page, MERT, "/panel");
    await page.evaluate(() => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const next = users.map((u) => {
        if (u.email !== "mert@test.com") return u;
        return {
          ...u,
          providerProfile: {
            companyName: "",
            bio: "",
            regions: [],
            expertise: ["Lashing", "Forklift Operatörü", "Depolama"],
          },
        };
      });
      localStorage.setItem("malsevk.users.v1", JSON.stringify(next));
    });

    await page.goto(`${BASE_URL}/panel/profil`);
    const serviceInfoHeadingVisible = await page
      .getByRole("heading", { name: "Hizmet Bilgilerim" })
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("Eski expertise'li profil sayfası çöküyor değil, 'Hizmet Bilgilerim' görünüyor", serviceInfoHeadingVisible);
    check(
      "'Lashing' (eşleşen eski değer) otomatik işaretli geliyor",
      (await page.getByRole("button", { name: "Lashing", exact: true }).getAttribute("aria-pressed")) === "true",
    );
    check(
      "'Forklift Operatörü' (eşleşen eski değer) otomatik işaretli geliyor",
      (await page.getByRole("button", { name: "Forklift Operatörü", exact: true }).getAttribute("aria-pressed")) === "true",
    );
    check(
      "Migrasyon sayesinde 'Hizmet Seçimi' tamamlanma kontrolü YEŞİL (met) görünüyor",
      await page
        .locator("li", { hasText: "Hizmet Seçimi" })
        .first()
        .evaluate((el) => el.className.includes("text-success")),
    );
    check("Migrasyon görüntüleme: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    // ============ 5) Kaydet: migrasyon kalıcı hâle geliyor, orijinal expertise BOZULMUYOR ============
    console.log("\n=== Kaydet: serviceCategories yazılıyor, expertise (Depolama dahil) korunuyor ===");
    await page.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    await page.getByText("Hizmet bilgileriniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });

    const profileAfterSave = await page.evaluate(() => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === "mert@test.com")?.providerProfile;
    });
    check(
      "serviceCategories'e migrasyon sonucu yazıldı (lashing, forklift-operatoru)",
      profileAfterSave?.serviceCategories?.includes("lashing") &&
        profileAfterSave?.serviceCategories?.includes("forklift-operatoru"),
    );
    check(
      "serviceCategories tam olarak 2 öğe (çoğaltma yok)",
      profileAfterSave?.serviceCategories?.length === 2,
      `bulunan: ${JSON.stringify(profileAfterSave?.serviceCategories)}`,
    );
    check(
      "Orijinal 'expertise' dizisi HİÇ DEĞİŞMEDEN korundu ('Depolama' dahil, veri kaybı yok)",
      profileAfterSave?.expertise?.length === 3 &&
        profileAfterSave.expertise.includes("Lashing") &&
        profileAfterSave.expertise.includes("Forklift Operatörü") &&
        profileAfterSave.expertise.includes("Depolama"),
      `bulunan: ${JSON.stringify(profileAfterSave?.expertise)}`,
    );

    // ============ 6) İdempotentlik: sayfayı birden çok kez aç/kapat, çoğaltma olmuyor ============
    console.log("\n=== İdempotentlik: tekrar tekrar açılınca çoğaltma oluşmuyor ===");
    await page.reload();
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(200);
    const profileAfterReloads = await page.evaluate(() => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      return users.find((u) => u.email === "mert@test.com")?.providerProfile;
    });
    check(
      "Birden fazla sayfa yenilemesinden sonra serviceCategories hâlâ 2 öğe (çoğaltma yok, salt okuma)",
      profileAfterReloads?.serviceCategories?.length === 2,
    );
    check(
      "'Lashing' hâlâ işaretli görünüyor (kalıcı, artık serviceCategories'ten)",
      (await page.getByRole("button", { name: "Lashing", exact: true }).getAttribute("aria-pressed")) === "true",
    );
    check("İdempotentlik kontrolü: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

    await context.close();

    // ============ 7) Mobil (375px): ilan oluşturma kategori seçimi ============
    console.log("\n=== Mobil (375px): ilan oluşturma formu, gruplu kategori seçimi ===");
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();
    attachDiagnostics(mobilePage);
    await login(mobilePage, ZEYNEP, "/hizmet-talebi-olustur");
    await mobilePage.getByLabel("Hizmet Kategorisi").selectOption({ label: "Sayım Hizmeti" });
    await checkNoHorizontalOverflow(mobilePage, "375px (ilan oluşturma)");
    check("Mobil: konsol hatası yok", mobilePage.jsProblems.length === 0, mobilePage.jsProblems.join(" | "));
    await mobileContext.close();

    // ============ 8) Demo hesaplar bozulmadı ============
    console.log("\n=== Demo hesaplar (Zeynep, Mert) hâlâ giriş yapabiliyor ===");
    const finalContext = await browser.newContext();
    const finalPage = await finalContext.newPage();
    attachDiagnostics(finalPage);
    await login(finalPage, ZEYNEP, "/panel");
    check("Zeynep hâlâ giriş yapabiliyor", finalPage.url() === `${BASE_URL}/panel`);
    await finalPage.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
    await login(finalPage, MERT, "/panel");
    check("Mert hâlâ giriş yapabiliyor", finalPage.url() === `${BASE_URL}/panel`);
    check("Demo hesap girişleri: konsol hatası yok", finalPage.jsProblems.length === 0, finalPage.jsProblems.join(" | "));
    await finalContext.close();

    console.log(anyFail ? "\nSONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "\nSONUÇ: TÜM KONTROLLER GEÇTİ.");
    if (anyFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[verify] GENEL HATA:", error);
  process.exitCode = 1;
});
