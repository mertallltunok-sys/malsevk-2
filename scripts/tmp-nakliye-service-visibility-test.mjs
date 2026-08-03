// "Nakliye" hizmet kategorisinin merkezi katalog (service-catalog.ts) üzerinden
// eklenmesinin VE Nakliye'ye özel ilan keşfi izolasyon kuralının (bkz.
// app/_lib/job-visibility.ts, tek doğruluk kaynağı) uçtan uca doğrulaması.
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).
//
// Gerçek yeni kullanıcılar oluşturur (her çalıştırmada benzersiz e-posta),
// mevcut demo hesaba (mert@test.com) yalnızca OKUMA amaçlı dokunulur —
// "Nakliye seçmemiş mevcut Hizmet Veren'in davranışı değişmiyor" regresyon
// kontrolü için.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const RUN_ID = Date.now();
const MERT = { email: "mert@test.com", password: "Mert123!" };
const ADMIN = { email: "admin@test.com", password: "Admin123!" };

let passed = 0;
let anyFail = false;
function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`    [OK  ] ${label}`);
  } else {
    anyFail = true;
    console.log(`    [FAIL] ${label}${detail ? " — " + detail : ""}`);
  }
}

function attachDiagnostics(page) {
  page.jsProblems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") page.jsProblems.push(`[console:error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => page.jsProblems.push(`[pageerror] ${String(err)}`));
}

async function waitForDevAccountSeeded(page, email, timeoutMs = 5000) {
  await page
    .waitForFunction(
      (targetEmail) => {
        try {
          const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
          return users.some((u) => u.email === targetEmail);
        } catch {
          return false;
        }
      },
      email,
      { timeout: timeoutMs },
    )
    .catch(() => {});
}

async function selectSearchable(page, fieldId, optionLabel) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole("option", { name: optionLabel, exact: true }).click();
}

async function fillCommonFields(page, { firstName, lastName, email, phone, password }) {
  await page.getByLabel("Ad", { exact: true }).fill(firstName);
  await page.getByLabel("Soyad", { exact: true }).fill(lastName);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Telefon Numarası").fill(phone);
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByLabel("Şifre Tekrar").fill(password);
}

const VALID_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function registerProvider(page, { firstName, lastName, email, phone, serviceLabels }) {
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Veren" }).click();
  await page.waitForTimeout(150);
  await fillCommonFields(page, { firstName, lastName, email, phone, password: "Guclu1!Sifre" });
  await page.getByLabel("Firma Adı").fill(`${firstName} ${lastName} Lojistik`);
  await page.getByLabel("Hizmet Veren Tipi").selectOption({ label: "Bireysel Hizmet Veren" });
  await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  for (const label of serviceLabels) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "faaliyet-belgesi.pdf", mimeType: "application/pdf", buffer: VALID_PDF_BYTES });
  await page.getByText("1 / 5 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel(/Yüklediğim belgelerin güncel/).check();
  await page.getByLabel(/Gizlilik Politikası/).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page
    .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
    .waitFor({ state: "visible", timeout: 15000 });
}

async function loginAs(page, email, password, redirect = "/panel") {
  await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await waitForDevAccountSeeded(page, email);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`${BASE_URL}${redirect}`, { timeout: 10000 });
}

async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
}

async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id ?? null;
  }, email);
}

/** tmp-proje-yuku-service-test.mjs ile AYNI seed deseni — gerçek fotoğraf yükleme UI'ını sürmeden geçerli bir Job üretir. */
async function seedJob(page, job) {
  await page.evaluate(async (jobInput) => {
    function openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("malsevk-photo-blobs", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    function putBlob(db, key, blob) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    function makeBlob(color) {
      return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 40, 40);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    }
    const db = await openDb();
    const storageKey = `${jobInput.id}-photo-0`;
    const blob = await makeBlob(jobInput.color || "#1e3a5f");
    await putBlob(db, storageKey, blob);
    const now = new Date().toISOString();
    const job = {
      id: jobInput.id,
      title: jobInput.title,
      category: jobInput.category,
      province: "Kocaeli",
      district: jobInput.district || "Gebze",
      workLocationType: "Test Tesis",
      description: `${jobInput.title} - test amaçlı oluşturulan ilan açıklaması.`,
      operationDetails: `${jobInput.title} - test amaçlı operasyon detayı.`,
      workDate: "2026-12-15",
      status: "yayinda",
      requesterId: jobInput.requesterId,
      operationId: jobInput.operationId,
      createdAt: now,
      photos: [
        { id: `${jobInput.id}-photo-id-0`, order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey },
      ],
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem(
      "malsevk.jobs.v1",
      JSON.stringify([...existing.filter((j) => j.id !== job.id), job]),
    );
    db.close();
  }, job);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  attachDiagnostics(page);

  // ============ 1) Nakliye, hizmet kategorisi kaynağında mevcut ============
  console.log("\n=== 1) Nakliye, merkezi hizmet kategorisi kaynağında mevcut ===");
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Veren" }).click();
  await page.waitForTimeout(150);
  check(
    "'Nakliye', Verdiğiniz Hizmetler çoklu seçiminde görünüyor",
    await page.getByRole("button", { name: "Nakliye", exact: true }).isVisible(),
  );

  // ============ 2) Hizmet Veren kayıt ekranında Nakliye seçilebiliyor ============
  console.log("\n=== 2) Hizmet Veren kayıtları: Nakliye-only ve Nakliye+Lashing ===");
  const nakliyeciEmail = `nakliyeci-${RUN_ID}@example.com`;
  await registerProvider(page, {
    firstName: "Nakliyeci",
    lastName: "Bir",
    email: nakliyeciEmail,
    phone: "+905361112233",
    serviceLabels: ["Nakliye"],
  });
  check("Nakliye-only Hizmet Veren kaydı başarılı", true);

  const karmaEmail = `karma-${RUN_ID}@example.com`;
  await registerProvider(page, {
    firstName: "Karma",
    lastName: "Iki",
    email: karmaEmail,
    phone: "+905362223344",
    serviceLabels: ["Nakliye", "Lashing"],
  });
  check("Nakliye+Lashing Hizmet Veren kaydı başarılı", true);
  check("Kayıt akışları: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  const svcState = await page.evaluate((emails) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    return emails.map((email) => {
      const user = users.find((u) => u.email === email);
      return user ? services.filter((s) => s.userId === user.id).map((s) => s.serviceCategoryId) : null;
    });
  }, [nakliyeciEmail, karmaEmail]);
  check("provider_services.v1: nakliyeci = ['nakliye']", JSON.stringify(svcState[0]) === JSON.stringify(["nakliye"]));
  check("provider_services.v1: karma içeriyor nakliye+lashing", [...svcState[1]].sort().join(",") === "lashing,nakliye");

  // ============ 3) Hizmet Alan: Nakliye kategori seçimi gerçek formda çalışıyor ============
  console.log("\n=== 3) Hizmet Alan: ilan oluşturma formunda Nakliye seçilebiliyor ===");
  const requesterEmail = `talep-${RUN_ID}@example.com`;
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Alan" }).click();
  await fillCommonFields(page, {
    firstName: "Talep",
    lastName: "Sahibi",
    email: requesterEmail,
    phone: "+905363334455",
    password: "Guclu1!Sifre",
  });
  await page.getByLabel("Firma Adı").fill("Test Talep A.Ş.");
  await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });
  await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  await page.getByLabel(/Gizlilik Politikası/).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page
    .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
    .waitFor({ state: "visible", timeout: 10000 });

  await loginAs(page, requesterEmail, "Guclu1!Sifre", "/hizmet-talebi-olustur");
  const requesterId = await getUserId(page, requesterEmail);

  const categorySelect = page.getByLabel("Hizmet Kategorisi");
  await categorySelect.waitFor({ state: "visible", timeout: 10000 });
  const nakliyeOption = await categorySelect.evaluate((select) => {
    const option = Array.from(select.querySelectorAll("option")).find((o) => o.value === "nakliye");
    const optgroup = option?.closest("optgroup");
    return { found: Boolean(option), label: option?.textContent, groupLabel: optgroup?.label };
  });
  check("'Hizmet Kategorisi' seçiminde value='nakliye' bulundu", nakliyeOption.found);
  check("Grup etiketi 'Nakliye Hizmetleri'", nakliyeOption.groupLabel === "Nakliye Hizmetleri");
  await categorySelect.selectOption("nakliye");
  check("'Nakliye' formda gerçekten seçilebiliyor", (await categorySelect.inputValue()) === "nakliye");

  // ============ 4) Test verisi: standalone Nakliye + Lashing ilanı, ve 4 hizmetli operasyon ============
  console.log("\n=== 4) Test ilanları oluşturuluyor (seed) ===");
  const nakliyeJobId = `nakliye-job-${RUN_ID}`;
  const lashingJobId = `lashing-job-${RUN_ID}`;
  const operationId = `operation-${RUN_ID}`;
  const opLashingId = `op-lashing-${RUN_ID}`;
  const opGozetimId = `op-gozetim-${RUN_ID}`;
  const opForkliftId = `op-forklift-${RUN_ID}`;
  const opNakliyeId = `op-nakliye-${RUN_ID}`;

  await seedJob(page, { id: nakliyeJobId, title: `Nakliye İlanı ${RUN_ID}`, category: "nakliye", requesterId });
  await seedJob(page, { id: lashingJobId, title: `Lashing İlanı ${RUN_ID}`, category: "lashing", requesterId });
  await seedJob(page, { id: opLashingId, title: `Operasyon Lashing ${RUN_ID}`, category: "lashing", requesterId, operationId });
  await seedJob(page, { id: opGozetimId, title: `Operasyon Gözetim ${RUN_ID}`, category: "yukleme-gozetimi", requesterId, operationId });
  await seedJob(page, { id: opForkliftId, title: `Operasyon Forklift ${RUN_ID}`, category: "forklift", requesterId, operationId });
  await seedJob(page, { id: opNakliyeId, title: `Operasyon Nakliye ${RUN_ID}`, category: "nakliye", requesterId, operationId });
  check("Test ilanları (standalone x2 + 4 hizmetli operasyon) seed edildi", true);

  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "Hizmet Alan kendi Nakliye ilanını Hizmet Taleplerim'de görüyor");
  await check_visible(page, `Lashing İlanı ${RUN_ID}`, "Hizmet Alan kendi Lashing ilanını Hizmet Taleplerim'de görüyor");

  await logout(page);

  // ============ 5) Nakliyeci (Nakliye-only): yalnızca Nakliye ilanlarını görüyor ============
  console.log("\n=== 5-6) Nakliyeci (Nakliye-only) yalnızca Nakliye ilanlarını görüyor ===");
  await loginAs(page, nakliyeciEmail, "Guclu1!Sifre", "/ilanlar");
  await page.waitForTimeout(300);

  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "Nakliyeci: standalone Nakliye ilanı görünüyor");
  check("Nakliyeci: Lashing ilanı GÖRÜNMÜYOR", (await page.getByText(`Lashing İlanı ${RUN_ID}`).count()) === 0);
  await check_visible(page, `Operasyon Nakliye ${RUN_ID}`, "Nakliyeci: operasyonun Nakliye alt ilanı görünüyor");
  check(
    "Nakliyeci: operasyonun diğer 3 hizmeti (Lashing/Gözetim/Forklift) GÖRÜNMÜYOR",
    (await page.getByText(`Operasyon Lashing ${RUN_ID}`).count()) === 0 &&
      (await page.getByText(`Operasyon Gözetim ${RUN_ID}`).count()) === 0 &&
      (await page.getByText(`Operasyon Forklift ${RUN_ID}`).count()) === 0,
  );
  check(
    "Nakliyeci: 'Operasyon · N Hizmet' rozeti GÖRÜNMÜYOR (yalnızca 1 üye görünür, tekil ilan olarak render edilir)",
    (await page.getByText(/Operasyon · \d Hizmet/).count()) === 0,
  );
  check("Nakliyeci ilan listesi: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ 6) Doğrudan URL ile Lashing ilanına erişim engelleniyor ============
  console.log("\n=== 7) Nakliyeci: doğrudan jobId URL ile Lashing ilanına erişemiyor ===");
  await page.goto(`${BASE_URL}/ilanlar/${lashingJobId}`);
  await check_visible(page, "İlan bulunamadı veya artık yayında değil.", "Doğrudan URL: 'İlan bulunamadı' güvenli mesajı gösteriliyor");
  check(
    "Gizli ilan başlığı sayfada HİÇ görünmüyor",
    (await page.getByText(`Lashing İlanı ${RUN_ID}`).count()) === 0,
  );
  check("Erişim reddi sayfası: konsol hatası yok / uygulama çökmedi", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ 7) Operasyondaki gizli kardeşlerin bilgisi sızmıyor ============
  console.log("\n=== 9-10) Nakliyeci: operasyon detayında yalnız Nakliye alt ilanını görüyor, kardeş bilgisi sızmıyor ===");
  await page.goto(`${BASE_URL}/ilanlar/${opNakliyeId}`);
  await check_visible(page, `Operasyon Nakliye ${RUN_ID}`, "Nakliyeci: operasyonun kendi (Nakliye) ilan detayına erişebiliyor");
  check(
    "'Operasyon Durumu' kartı GÖRÜNMÜYOR (yalnızca 1 görünür üye)",
    (await page.getByText("Operasyon Durumu").count()) === 0,
  );
  check(
    "Diğer 3 kardeş hizmetin başlığı/varlığı sayfada HİÇ sızmıyor",
    (await page.getByText(`Operasyon Lashing ${RUN_ID}`).count()) === 0 &&
      (await page.getByText(`Operasyon Gözetim ${RUN_ID}`).count()) === 0 &&
      (await page.getByText(`Operasyon Forklift ${RUN_ID}`).count()) === 0 &&
      (await page.getByText("4 hizmet", { exact: false }).count()) === 0,
  );

  // ============ 8) Nakliyeci Nakliye ilanına teklif verebiliyor (offer yaşam döngüsü) ============
  console.log("\n=== 12) Nakliyeci Nakliye ilanına teklif verebiliyor; teklif/kabul/bildirim akışı çalışıyor ===");
  await page.goto(`${BASE_URL}/ilanlar/${nakliyeJobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("15000");
  await page.getByLabel("Teklif Açıklaması").fill("Nakliye hizmeti için test teklifi - araç ve ekip hazır.");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("1 iş günü");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await check_visible(page, "Teklifiniz başarıyla gönderildi.", "Nakliyeci: Nakliye ilanına teklif başarıyla gönderildi");
  check("Teklif verme akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  await logout(page);

  // ============ 9) Talep sahibi teklifi kabul ediyor, bildirim ulaşıyor ============
  await loginAs(page, requesterEmail, "Guclu1!Sifre", "/panel/gelen-teklifler");
  await page.getByRole("button", { name: "Kabul Et" }).first().click();
  await page.waitForTimeout(300);
  check("Talep sahibi Nakliye teklifini kabul edebildi (Kabul Et tıklanabildi)", true);
  await logout(page);

  await loginAs(page, nakliyeciEmail, "Guclu1!Sifre", "/panel/bildirimler");
  await check_visible(page, "Hizmet Alan teklifinizi kabul etti.", "Nakliyeci: 'teklif kabul edildi' bildirimi ulaştı");
  check("Nakliyeci bildirimler: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // ============ 10) Karma (Nakliye+Lashing) da yalnızca Nakliye görüyor ============
  console.log("\n=== 6) Karma (Nakliye+Lashing) hâlâ yalnızca Nakliye ilanlarını görüyor ===");
  await loginAs(page, karmaEmail, "Guclu1!Sifre", "/ilanlar");
  await page.waitForTimeout(300);
  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "Karma: Nakliye ilanı görünüyor");
  check(
    "Karma: Lashing seçili olmasına rağmen Lashing ilanı GÖRÜNMÜYOR",
    (await page.getByText(`Lashing İlanı ${RUN_ID}`).count()) === 0,
  );

  // ============ 11) Nakliye kaldırılınca normal görünürlük geri geliyor ============
  console.log("\n=== 13) Karma profilinden Nakliye kaldırılınca normal görünürlük geri geliyor ===");
  await page.goto(`${BASE_URL}/panel/profil`);
  const nakliyeChip = page.getByRole("button", { name: "Nakliye", exact: true });
  await nakliyeChip.waitFor({ state: "visible", timeout: 10000 });
  check("Karma profilinde Nakliye chip'i başlangıçta seçili (aria-pressed=true)", (await nakliyeChip.getAttribute("aria-pressed")) === "true");
  await nakliyeChip.click();
  check("Nakliye chip'i tıklanınca seçimi kalkıyor (aria-pressed=false)", (await nakliyeChip.getAttribute("aria-pressed")) === "false");
  await page.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
  await check_visible(page, "Hizmet bilgileriniz kaydedildi.", "Hizmet Bilgilerim kaydı başarılı (Nakliye kaldırıldı)");

  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForTimeout(300);
  await check_visible(page, `Lashing İlanı ${RUN_ID}`, "Nakliye kaldırıldıktan SONRA: Lashing ilanı artık görünüyor (normal davranışa dönüş)");
  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "Nakliye kaldırıldıktan SONRA: Nakliye ilanı da hâlâ görünüyor (genel ilan, kısıtlama yok)");
  check("Profil güncelleme akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  const karmaId = await getUserId(page, karmaEmail);
  const karmaServicesAfter = await page.evaluate((uid) => {
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    return services.filter((s) => s.userId === uid).map((s) => s.serviceCategoryId);
  }, karmaId);
  check("provider_services.v1: Karma artık yalnızca ['lashing']", JSON.stringify(karmaServicesAfter) === JSON.stringify(["lashing"]));

  await logout(page);

  // ============ 12) Nakliye seçmemiş mevcut demo hesap (mert) davranışı değişmedi ============
  console.log("\n=== 11) Nakliye seçmemiş mevcut Hizmet Veren (mert@test.com): davranış değişmedi ===");
  await loginAs(page, MERT.email, MERT.password, "/ilanlar");
  await page.waitForTimeout(300);
  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "mert: Nakliye ilanı görünüyor (kısıtlama yok)");
  await check_visible(page, `Lashing İlanı ${RUN_ID}`, "mert: Lashing ilanı görünüyor (kısıtlama yok)");
  // job-listing-row.ts#getJobListingCategoryBadgeLabel'ın GÜNCEL/kasıtlı
  // formatı "Operasyon • {kalan} Hizmet Arıyor"dur (statik "Operasyon · N
  // Hizmet" biçimi bu Nakliye testinden BAĞIMSIZ, önceki bir özellik
  // çalışmasında kalıcı olarak değiştirildi — bkz. CLAUDE.md "Operation
  // discovery & status UI"). mert hiçbir izole kategori seçmediği için
  // operasyonun TÜM 4 üyesini görür, `kalan = totalCount(4) - completedCount(0) = 4`.
  await check_visible(page, "Operasyon • 4 Hizmet Arıyor", "mert: 4 hizmetli operasyon TAM rozetiyle ('Operasyon • 4 Hizmet Arıyor') görünüyor — hiçbir izolasyon uygulanmadı");
  check("mert (unrestricted) ilan listesi: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // ============ 13) Admin ve Hizmet Alan erişimleri bozulmuyor ============
  console.log("\n=== 14) Admin ve Hizmet Alan erişimleri bozulmuyor ===");
  await loginAs(page, ADMIN.email, ADMIN.password, "/admin");
  await check_visible(page, "Hizmet Veren Belge Kontrolü", "Admin paneli hâlâ normal açılıyor");
  check("Admin paneli: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // Nakliye ilanının teklifi bu testte daha önce kabul edildiği için ilan
  // artık "Aktif" değil "Devam Eden" sekmesindedir (bkz. job-requests.ts#
  // getJobRequestFilter) — bu, Nakliye izolasyonuyla İLGİSİZ, mevcut/beklenen
  // ilan yaşam döngüsü davranışıdır.
  await loginAs(page, requesterEmail, "Guclu1!Sifre", "/panel/hizmet-taleplerim?durum=devam-eden");
  await check_visible(page, `Nakliye İlanı ${RUN_ID}`, "Hizmet Alan: kendi Nakliye ilanı Hizmet Taleplerim'de (Devam Eden) hâlâ görünüyor");
  check("Hizmet Alan paneli: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  await context.close();

  console.log(`\n[tmp-nakliye-service-visibility-test] ${passed} kontrol geçti.`);
  console.log(anyFail ? "SONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "SONUÇ: TÜM KONTROLLER GEÇTİ.");
  if (anyFail) process.exitCode = 1;
}

async function check_visible(page, text, label) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
    check(label, true);
  } catch (error) {
    check(label, false, String(error).split("\n")[0]);
  }
}

main()
  .catch((error) => {
    console.error("[tmp-nakliye-service-visibility-test] GENEL HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
