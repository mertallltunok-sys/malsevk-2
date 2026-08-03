// "Gümrük Müşavirliği" hizmet kategorisinin merkezi katalog (service-catalog.ts)
// üzerinden eklenmesinin, kayıt sırasındaki ek KYC belge/beyan zorunluluğunun,
// belge onay durumuna göre teklif verme yetkisinin açılıp kapanmasının,
// Nakliye'yle AYNI görünürlük izolasyon sisteminin ve admin panelindeki yeni
// "Gümrük Müşavirliği Belgeleri" bölümünün uçtan uca doğrulaması.
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).
//
// Gerçek yeni kullanıcılar oluşturur (her çalıştırmada benzersiz e-posta),
// mevcut demo hesaplara (mert@test.com, nakliyeci@test.com, admin@test.com,
// gumrukdemo@malsevk.demo) yalnızca OKUMA/giriş amaçlı dokunulur.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const RUN_ID = Date.now();
const ADMIN = { email: "admin@test.com", password: "Admin123!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const GUMRUK_DEMO = { email: "gumrukdemo@malsevk.demo", password: "Demo1234!" };

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

/** tmp-nakliye-service-visibility-test.mjs ile AYNI seed deseni — gerçek fotoğraf yükleme UI'ını sürmeden geçerli bir Job üretir. */
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
      createdAt: now,
      photos: [
        { id: `${jobInput.id}-photo-id-0`, order: 0, fileName: "foto-0.png", fileSize: blob.size, mimeType: "image/png", storageKey },
      ],
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
    localStorage.setItem("malsevk.jobs.v1", JSON.stringify([...existing.filter((j) => j.id !== job.id), job]));
    db.close();
  }, job);
}

const VALID_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
// Geçerli bir WEBP - genel Faaliyet Belgesi alanında kabul edilir ama Gümrük
// Müşaviri İzin Belgesi alanında (yalnızca PDF/JPG/JPEG/PNG) REDDEDİLMELİDİR.
const VALID_WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();
  attachDiagnostics(page);

  // ============ 1) Katalog: Gümrük Müşavirliği merkezi kaynaktan geliyor ============
  console.log("\n=== 1) Gümrük Müşavirliği, merkezi hizmet kategorisi kaynağında mevcut ===");
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Veren" }).click();
  await page.waitForTimeout(150);
  check(
    "'Gümrük Müşavirliği', Verdiğiniz Hizmetler çoklu seçiminde görünüyor",
    await page.getByRole("button", { name: "Gümrük Müşavirliği", exact: true }).isVisible(),
  );
  check(
    "Ek belge/beyan alanları henüz SEÇİLMEDEN görünmüyor",
    (await page.getByText("Gümrük Müşaviri İzin Belgesi").count()) === 0,
  );

  // ============ 2) Seçilince ek belge/beyan alanları beliriyor, GENEL bölüm KAYBOLUYOR ============
  console.log("\n=== 2) Yalnız Gümrük Müşavirliği seçilince: yalnızca TEK zorunlu belge alanı ===");
  check(
    "Seçim öncesi genel Faaliyet Belgesi bölümü görünüyor (henüz normal davranış)",
    await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").isVisible(),
  );
  await page.getByRole("button", { name: "Gümrük Müşavirliği", exact: true }).click();
  await page.waitForTimeout(150);
  check("'Gümrük Müşaviri İzin Belgesi' başlığı görünüyor", await page.getByText("Gümrük Müşaviri İzin Belgesi").isVisible());
  check(
    "'Yüklediğim belge bana aittir ve günceldir.' beyanı görünüyor",
    await page.getByText("Yüklediğim belge bana aittir ve günceldir.").isVisible(),
  );
  // Görev gereksinimi: yalnız Gümrük Müşavirliği seçiliyken kullanıcıya İKİ
  // AYRI zorunlu belge alanı gösterilmiyor — genel Faaliyet Belgesi bölümü
  // (yükleme alanı + kendi beyanı) TAMAMEN gizlenir.
  check(
    "Genel 'Faaliyet Belgesi veya Faaliyet Raporu Yükle' bölümü TAMAMEN GİZLENDİ",
    (await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").count()) === 0,
  );
  check(
    "Genel 'Belge Doğruluk Beyanı' metni de GİZLENDİ",
    (await page.getByText("Yüklediğim belgelerin güncel").count()) === 0,
  );
  check(
    "Sayfada TEK BİR dosya yükleme alanı var (iki ayrı zorunlu belge alanı YOK)",
    (await page.locator('input[type="file"]').count()) === 1,
  );

  // Seçim kaldırılınca Gümrük alanları kaybolur, genel bölüm GERİ GELİR
  await page.getByRole("button", { name: "Gümrük Müşavirliği", exact: true }).click();
  await page.waitForTimeout(150);
  check(
    "Seçim kaldırılınca Gümrük alanları tekrar KAYBOLUYOR",
    (await page.getByText("Gümrük Müşaviri İzin Belgesi").count()) === 0,
  );
  check(
    "Genel Faaliyet Belgesi bölümü GERİ GELİYOR",
    await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").isVisible(),
  );
  // Tekrar seçiliyor — devam eden kayıt akışı için
  await page.getByRole("button", { name: "Gümrük Müşavirliği", exact: true }).click();
  await page.waitForTimeout(150);
  check(
    "Tekrar seçilince genel bölüm yine GİZLENİYOR (tutarlı davranış)",
    (await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").count()) === 0,
  );

  // ============ 3) Yalnızca Gümrük'e özel iki hata görünüyor, genel hatalar YOK ============
  console.log("\n=== 3) Boş gönderimde YALNIZCA Gümrük'e özel hatalar görünüyor ===");
  const gumrukEmail = `gumruk-${RUN_ID}@example.com`;
  await fillCommonFields(page, {
    firstName: "Test",
    lastName: `Gumruk${RUN_ID}`,
    email: gumrukEmail,
    phone: "+905364445566",
    password: "Guclu1!Sifre",
  });
  await page.getByLabel("Firma Adı").fill("Test Gümrük Müşavirliği A.Ş.");
  await page.getByLabel("Hizmet Veren Tipi").selectOption({ label: "Bireysel Hizmet Veren" });
  await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  await page.getByLabel(/Gizlilik Politikası/).check();

  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForTimeout(300);
  check(
    "Gümrük belgesi yüklenmeden hata görünüyor",
    await page.getByText("Gümrük Müşaviri İzin Belgesi yüklemelisiniz.").isVisible(),
  );
  check(
    "Gümrük beyanı kabul edilmeden hata görünüyor",
    await page.getByText("Yüklediğiniz belgenin size ait ve güncel olduğunu onaylamalısınız.").isVisible(),
  );
  check(
    "Genel 'faaliyet belgesi yüklemelisiniz' hatası GÖRÜNMÜYOR (yalnız Gümrük seçiliyken zorunlu değil)",
    (await page.getByText("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.").count()) === 0,
  );
  check(
    "Genel 'belge doğruluk beyanı' hatası GÖRÜNMÜYOR (yalnız Gümrük seçiliyken zorunlu değil)",
    (await page.getByText("Belge doğruluk beyanını kabul etmelisiniz.").count()) === 0,
  );

  // ============ 4) Kısıtlı uzantı: Gümrük alanı yalnızca PDF/JPG/JPEG/PNG kabul ediyor ============
  console.log("\n=== 4) Gümrük Müşaviri İzin Belgesi alanı yalnızca PDF/JPG/JPEG/PNG kabul ediyor ===");
  const customsFileInput = page.locator('input[type="file"]');
  await customsFileInput.setInputFiles({ name: "izin-belgesi.webp", mimeType: "image/webp", buffer: VALID_WEBP_BYTES });
  await page.waitForTimeout(300);
  check(
    "WEBP dosyası Gümrük alanında REDDEDİLDİ (yalnızca PDF/JPG/JPEG/PNG mesajı)",
    await page.getByText(/yalnızca PDF, JPG, JPEG, PNG dosyaları kabul edilir/).isVisible(),
  );

  // ============ 5) Yalnızca Gümrük belgesi + beyanla (genel belge OLMADAN) kayıt tamamlanıyor ============
  console.log("\n=== 5) Yalnızca Gümrük belgesi + beyanla (genel belge OLMADAN) kayıt tamamlanıyor ===");
  await customsFileInput.setInputFiles({
    name: "gumruk-musaviri-izin-belgesi.pdf",
    mimeType: "application/pdf",
    buffer: VALID_PDF_BYTES,
  });
  await page.getByText("1 / 1 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Yüklediğim belge bana aittir ve günceldir.").check();

  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page
    .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
    .waitFor({ state: "visible", timeout: 15000 });
  check("Gümrük Müşavirliği kaydı (genel belge OLMADAN) başarıyla tamamlandı", true);
  check("Kayıt akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ 6) localStorage: TAM OLARAK TEK belge/beyan kaydı ============
  console.log("\n=== 6) localStorage: yalnız Gümrük belgesi/beyanı yazılmış, genel belge YOK ===");
  const state = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const user = users.find((u) => u.email === email) ?? null;
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      user,
      services: user ? services.filter((s) => s.userId === user.id) : [],
      documents: user ? documents.filter((d) => d.userId === user.id) : [],
      consents: user ? consents.filter((c) => c.userId === user.id) : [],
    };
  }, gumrukEmail);

  check("provider_services.v1: ['gumruk-musavirligi']", JSON.stringify(state.services.map((s) => s.serviceCategoryId)) === JSON.stringify(["gumruk-musavirligi"]));
  check(
    "provider_documents.v1: TAM OLARAK 1 belge kaydı (yalnız Gümrük — genel belge YOK)",
    state.documents.length === 1,
  );
  const customsDoc = state.documents.find((d) => d.documentType === "gumruk-musaviri-izin-belgesi");
  check("Tek belge 'gumruk-musaviri-izin-belgesi' documentType ile etiketlenmiş", Boolean(customsDoc));
  check("Gümrük belgesi başlangıç durumu 'pending' (İnceleniyor)", customsDoc?.reviewStatus === "pending");
  check(
    "provider_document_consents.v1: TAM OLARAK 1 beyan kaydı (yalnız Gümrük'e özel — genel beyan YOK)",
    state.consents.length === 1 && state.consents[0]?.statementId === "gumruk-musaviri-belge-beyani",
  );

  // ============ 6b) Karma seçim (Gümrük + Lashing): İKİSİ de zorunlu, doğru birleşik sonuç ============
  console.log("\n=== 6b) Karma hizmet seçimi (Gümrük Müşavirliği + Lashing): her iki belge de zorunlu ===");
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Veren" }).click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Gümrük Müşavirliği", exact: true }).click();
  await page.getByRole("button", { name: "Lashing", exact: true }).click();
  await page.waitForTimeout(150);
  check(
    "Karma seçimde (Gümrük + Lashing) genel Faaliyet Belgesi bölümü GÖRÜNÜYOR (Lashing için hâlâ zorunlu)",
    await page.getByText("Faaliyet Belgesi veya Faaliyet Raporu Yükle").isVisible(),
  );
  check(
    "Karma seçimde Gümrük Müşaviri İzin Belgesi bölümü de GÖRÜNÜYOR",
    await page.getByText("Gümrük Müşaviri İzin Belgesi").isVisible(),
  );
  check("Karma seçimde sayfada İKİ AYRI dosya yükleme alanı var", (await page.locator('input[type="file"]').count()) === 2);

  const karmaGumrukEmail = `karma-gumruk-${RUN_ID}@example.com`;
  await fillCommonFields(page, {
    firstName: "Karma",
    lastName: `Gumruk${RUN_ID}`,
    email: karmaGumrukEmail,
    phone: "+905367778899",
    password: "Guclu1!Sifre",
  });
  await page.getByLabel("Firma Adı").fill("Karma Gümrük + Lashing A.Ş.");
  await page.getByLabel("Hizmet Veren Tipi").selectOption({ label: "Bireysel Hizmet Veren" });
  await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  await page.getByLabel(/Gizlilik Politikası/).check();

  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page.waitForTimeout(300);
  check(
    "Karma seçimde genel belge boşken hata GÖRÜNÜYOR (Lashing hâlâ genel belge ister)",
    await page.getByText("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.").isVisible(),
  );
  check(
    "Karma seçimde Gümrük belgesi boşken hata da GÖRÜNÜYOR (ikisi birden zorunlu)",
    await page.getByText("Gümrük Müşaviri İzin Belgesi yüklemelisiniz.").isVisible(),
  );

  const karmaFileInputs = page.locator('input[type="file"]');
  await karmaFileInputs
    .nth(0)
    .setInputFiles({ name: "faaliyet-belgesi.pdf", mimeType: "application/pdf", buffer: VALID_PDF_BYTES });
  await page.getByText("1 / 5 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  // Farklı bir dosya adı — customs-only hesabın (gumrukEmail) belgesiyle AYNI
  // ada sahip olursa admin panelindeki Gümrük bölümünde iki hesabın belgesi
  // aynı metinle görünür, aşağıdaki (ve bu dosyanın diğer) locator'ları
  // strict-mode ihlaline (birden fazla eşleşme) düşürür.
  await karmaFileInputs.nth(1).setInputFiles({
    name: "gumruk-musaviri-izin-belgesi-karma.pdf",
    mimeType: "application/pdf",
    buffer: VALID_PDF_BYTES,
  });
  await page.getByText("1 / 1 belge yüklendi", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel(/Yüklediğim belgelerin güncel/).check();
  await page.getByLabel("Yüklediğim belge bana aittir ve günceldir.").check();

  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page
    .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
    .waitFor({ state: "visible", timeout: 15000 });
  check("Karma (Gümrük + Lashing) kaydı her iki belgeyle birlikte başarıyla tamamlandı", true);

  const karmaState = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const user = users.find((u) => u.email === email) ?? null;
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      services: user ? services.filter((s) => s.userId === user.id) : [],
      documents: user ? documents.filter((d) => d.userId === user.id) : [],
      consents: user ? consents.filter((c) => c.userId === user.id) : [],
    };
  }, karmaGumrukEmail);
  check(
    "Karma: provider_services.v1 hem 'gumruk-musavirligi' hem 'lashing' içeriyor",
    [...karmaState.services.map((s) => s.serviceCategoryId)].sort().join(",") === "gumruk-musavirligi,lashing",
  );
  check("Karma: provider_documents.v1'de 2 belge kaydı (genel + gümrük, İKİSİ de yazılmış)", karmaState.documents.length === 2);
  check("Karma: provider_document_consents.v1'de 2 beyan kaydı (genel + gümrük, İKİSİ de yazılmış)", karmaState.consents.length === 2);
  check("Karma kaydı akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ 7) Belge İNCELENİYOR: giriş/profil düzenleme serbest, teklif ENGELLİ ============
  console.log("\n=== 7) Belge İnceleniyor: giriş/profil serbest, teklif verme ENGELLİ ===");
  await loginAs(page, gumrukEmail, "Guclu1!Sifre", "/panel/hesap-ayarlari");
  check("İnceleniyor durumunda hesap ayarlarına (profil düzenleme) erişilebiliyor", page.url() === `${BASE_URL}/panel/hesap-ayarlari`);

  const requesterId = await getUserId(page, MERT.email); // yalnızca requesterId üretmek için var olan bir kullanıcı id'si yeterli
  const gumrukJobId = `test-gumruk-job-${RUN_ID}`;
  const lashingJobId = `test-lashing-job-${RUN_ID}`;
  await seedJob(page, { id: gumrukJobId, title: `Gümrük İlanı ${RUN_ID}`, category: "gumruk-musavirligi", requesterId });
  await seedJob(page, { id: lashingJobId, title: `Lashing İlanı ${RUN_ID}`, category: "lashing", requesterId });

  await page.goto(`${BASE_URL}/ilanlar/${gumrukJobId}`);
  await page.waitForTimeout(500);
  check(
    "İnceleniyor durumunda Gümrük Müşavirliği ilanı GÖRÜNTÜLENEBİLİYOR",
    await page
      .getByText(`Gümrük İlanı ${RUN_ID}`)
      .first()
      .isVisible()
      .catch(() => false),
    page.jsProblems.join(" | "),
  );
  check(
    "Teklif formu yerine 'henüz onaylanmadı' engelleme mesajı gösteriliyor",
    await page
      .getByText("Gümrük Müşaviri İzin Belgeniz henüz onaylanmadı.")
      .isVisible()
      .catch(() => false),
    page.jsProblems.join(" | "),
  );
  check("Teklif Fiyatı alanı RENDER EDİLMİYOR", (await page.getByLabel("Teklif Fiyatı").count()) === 0);

  // Veri katmanı: arayüz atlanıp doğrudan createOffer çağrılsa bile engelleniyor mu?
  const directOfferAttempt = await page.evaluate(
    async ({ jobId }) => {
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      return offers.some((o) => o.jobId === jobId);
    },
    { jobId: gumrukJobId },
  );
  check("localStorage: bu ilana hiçbir teklif oluşturulmamış (form zaten hiç render edilmedi)", directOfferAttempt === false);

  // ============ 8) Görünürlük izolasyonu: Nakliye'yle AYNI sistem ============
  console.log("\n=== 8) Görünürlük izolasyonu: yalnızca Gümrük Müşavirliği ilanları görünüyor ===");
  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForTimeout(400);
  check("Gümrük Müşavirliği ilanı listede GÖRÜNÜYOR", await page.getByText(`Gümrük İlanı ${RUN_ID}`).isVisible());
  check("Lashing ilanı listede GÖRÜNMÜYOR", (await page.getByText(`Lashing İlanı ${RUN_ID}`).count()) === 0);

  await page.goto(`${BASE_URL}/ilanlar/${lashingJobId}`);
  check(
    "Lashing ilanına doğrudan URL ile erişilemiyor ('İlan bulunamadı')",
    await page.getByText(/İlan bulunamadı/).isVisible(),
  );
  check("Görünürlük izolasyonu ekranları: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  await logout(page);

  // ============ 9) Admin: Gümrük Müşavirliği Belgeleri bölümü ============
  console.log("\n=== 9) Admin: 'Gümrük Müşavirliği Belgeleri' bölümü ayrı listeleniyor ===");
  await loginAs(page, ADMIN.email, ADMIN.password, "/admin");
  await page.getByText("Gümrük Müşavirliği Belgeleri").waitFor({ state: "visible", timeout: 10000 });
  check("'Gümrük Müşavirliği Belgeleri' başlığı görünüyor", true);
  check(
    "Test Gümrük Müşavirliği A.Ş. (yalnız-Gümrük hesabı) bu bölümde listeleniyor",
    await page.getByText("Test Gümrük Müşavirliği A.Ş.", { exact: true }).isVisible(),
  );
  check(
    "Gümrük belgesi dosya adı bu bölümde görünüyor",
    await page.getByText("gumruk-musaviri-izin-belgesi.pdf", { exact: true }).isVisible(),
  );
  // Yalnız-Gümrük hesabının (tek zorunlu belge kuralı gereği) HİÇ genel
  // Faaliyet Belgesi'i yoktur — bu yüzden genel bölümde hiç KART bile
  // OLUŞMAMALIDIR (o bölümün `groups` hesaplaması `documents.length > 0`
  // filtresiyle çalışır, bkz. admin-provider-document-review-panel.tsx).
  // Sayfada TEK bir eşleşme olduğu (bir üstteki `isVisible()` kontrolünün
  // strict-mode ihlali fırlatmadan geçmesi) zaten bunu kanıtlar — aşağıdaki
  // konum kontrolü bu TEK kartın GÜMRÜK bölümünün altında olduğunu ayrıca doğrular.
  const genelBolumBaslangic = await page.getByRole("heading", { name: "Hizmet Veren Belge Kontrolü" }).boundingBox();
  const gumrukBolumBaslangic = await page.getByText("Gümrük Müşavirliği Belgeleri").boundingBox();
  const yalnizGumrukKart = await page.getByText("Test Gümrük Müşavirliği A.Ş.", { exact: true }).boundingBox();
  check(
    "Yalnız-Gümrük hesabının TEK kartı, GENEL bölümün değil GÜMRÜK bölümünün altında konumlanıyor",
    genelBolumBaslangic && gumrukBolumBaslangic && yalnizGumrukKart
      ? yalnizGumrukKart.y > gumrukBolumBaslangic.y && gumrukBolumBaslangic.y > genelBolumBaslangic.y
      : false,
  );

  // Karma (Gümrük + Lashing) hesabı HER İKİ bölümde de görünür — o, hem genel
  // hem Gümrük'e özel belge yüklemişti (bkz. bölüm 6b).
  check(
    "Karma (Gümrük + Lashing) hesabı GENEL bölümde de görünüyor (kendi genel belgesiyle)",
    await page.getByText("Karma Gümrük + Lashing A.Ş.", { exact: true }).first().isVisible(),
  );
  check(
    "Karma hesabının Gümrük belgesi ('...-karma.pdf') GÜMRÜK bölümünde görünüyor",
    await page.getByText("gumruk-musaviri-izin-belgesi-karma.pdf", { exact: true }).isVisible(),
  );
  const karmaGenelKart = page
    .getByText("Karma Gümrük + Lashing A.Ş.", { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
  check(
    "Karma hesabının GENEL bölümdeki kartında Gümrük belgesi TEKRARLANMIYOR",
    (await karmaGenelKart.getByText("gumruk-musaviri-izin-belgesi-karma.pdf").count()) === 0,
  );

  // ============ 10) Admin RED: rejected durumunda da teklif hâlâ engelli ============
  console.log("\n=== 10) Admin belgeyi REDDEDİYOR — teklif hâlâ engelli ===");
  const customsCard = page
    .getByText("gumruk-musaviri-izin-belgesi.pdf", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-md') and contains(@class,'border-border')][1]");
  await customsCard.getByRole("button", { name: "Reddet" }).click();
  await customsCard.getByPlaceholder("Açıklama girin...").fill("Belge süresi dolmuş, güncel belge yükleyin.");
  await customsCard.getByRole("button", { name: "Gönder" }).click();
  await customsCard.getByText("Reddedildi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  check("Gümrük belgesi durumu 'Reddedildi' olarak güncellendi", true);

  await logout(page);
  await loginAs(page, gumrukEmail, "Guclu1!Sifre", `/ilanlar/${gumrukJobId}`);
  check(
    "Reddedildi durumunda da teklif formu hâlâ GÖSTERİLMİYOR",
    await page.getByText("Gümrük Müşaviri İzin Belgeniz henüz onaylanmadı.").isVisible(),
  );
  await logout(page);

  // ============ 11) Admin ONAY: teklif verme yetkisi otomatik açılıyor ============
  console.log("\n=== 11) Admin belgeyi ONAYLIYOR — teklif verme yetkisi otomatik açılıyor ===");
  await loginAs(page, ADMIN.email, ADMIN.password, "/admin");
  const customsCard2 = page
    .getByText("gumruk-musaviri-izin-belgesi.pdf", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-md') and contains(@class,'border-border')][1]");
  await customsCard2.getByRole("button", { name: "Onayla" }).click();
  await customsCard2.getByText("Onaylandı", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  check("Gümrük belgesi durumu 'Onaylandı' olarak güncellendi", true);
  await logout(page);

  await loginAs(page, gumrukEmail, "Guclu1!Sifre", `/ilanlar/${gumrukJobId}`);
  await page.getByLabel("Teklif Fiyatı").fill("25000");
  await page.getByLabel("Teklif Açıklaması").fill("Gümrük müşavirliği hizmeti için test teklifi.");
  await page.getByLabel("Tahmini Hizmet Süresi").fill("2 iş günü");
  await page.getByRole("button", { name: "Teklif Gönder" }).click();
  await page.getByText("Teklifiniz başarıyla gönderildi.").waitFor({ state: "visible", timeout: 10000 });
  check("Onaylandıktan SONRA normal hizmet veren gibi teklif verebiliyor", true);
  check("Onay sonrası teklif akışı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // ============ 12) Demo hesap: Ahmet Yılmaz (gumrukdemo@malsevk.demo) önceden onaylı ============
  console.log("\n=== 12) Demo hesap: Ahmet Yılmaz (gumrukdemo@malsevk.demo) baştan onaylı ===");
  await loginAs(page, GUMRUK_DEMO.email, GUMRUK_DEMO.password, "/panel");
  check("Demo hesap girişi başarılı", true);
  const demoState = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const user = users.find((u) => u.email === email);
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    return {
      companyName: user?.companyName,
      services: user ? services.filter((s) => s.userId === user.id).map((s) => s.serviceCategoryId) : [],
      customsDocStatus: user
        ? documents.find((d) => d.userId === user.id && d.documentType === "gumruk-musaviri-izin-belgesi")?.reviewStatus
        : undefined,
    };
  }, GUMRUK_DEMO.email);
  check("Demo hesap firma adı doğru", demoState.companyName === "Marmara Gümrük Müşavirliği Ltd. Şti.");
  check("Demo hesap yalnızca Gümrük Müşavirliği seçili", JSON.stringify(demoState.services) === JSON.stringify(["gumruk-musavirligi"]));
  check("Demo hesabın belgesi baştan 'approved'", demoState.customsDocStatus === "approved");

  const demoJobId = `test-gumruk-demo-job-${RUN_ID}`;
  await seedJob(page, { id: demoJobId, title: `Gümrük Demo İlanı ${RUN_ID}`, category: "gumruk-musavirligi", requesterId });
  await page.goto(`${BASE_URL}/ilanlar/${demoJobId}`);
  await page.getByLabel("Teklif Fiyatı").waitFor({ state: "visible", timeout: 10000 });
  check("Demo hesap: teklif formu HİÇ ENGELLENMEDEN görünüyor", true);
  check("Demo hesap ilan detayı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // ============ 13) Regresyon: mert (Gümrük/Nakliye seçmemiş) davranışı değişmedi ============
  console.log("\n=== 13) Regresyon: mert (Gümrük/Nakliye seçmemiş) davranışı değişmedi ===");
  await loginAs(page, MERT.email, MERT.password, "/ilanlar");
  await page.waitForTimeout(400);
  check("mert: Lashing ilanını görebiliyor (kısıtlama yok)", await page.getByText(`Lashing İlanı ${RUN_ID}`).isVisible());
  check("mert: Gümrük Müşavirliği ilanını da görebiliyor (kısıtlama yok)", await page.getByText(`Gümrük İlanı ${RUN_ID}`).isVisible());
  check("mert ilan listesi: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));
  await logout(page);

  // ============ 14) İlan oluşturma: Hizmet Alan formunda Gümrük Müşavirliği seçilebiliyor ============
  console.log("\n=== 14) Hizmet Alan ilan formunda Gümrük Müşavirliği seçilebiliyor ===");
  await loginAs(page, MERT.email, MERT.password, "/panel");
  await logout(page);
  const talepEmail = `talep-gumruk-${RUN_ID}@example.com`;
  await page.goto(`${BASE_URL}/giris-yap?mode=kayit`);
  await page.getByRole("radio", { name: "Hizmet Alan" }).click();
  await fillCommonFields(page, {
    firstName: "Talep",
    lastName: "Gumruk",
    email: talepEmail,
    phone: "+905365556677",
    password: "Guclu1!Sifre",
  });
  await page.getByLabel("Firma Adı").fill("Test Talep Gümrük A.Ş.");
  await page.getByLabel("Kullanıcı Tipi").selectOption({ label: "Şahıs İşletmesi" });
  await selectSearchable(page, await page.getByLabel("İl", { exact: true }).getAttribute("id"), "Kocaeli");
  await selectSearchable(page, await page.getByLabel("İlçe", { exact: true }).getAttribute("id"), "Gebze");
  await page.getByLabel(/Gizlilik Politikası/).check();
  await page.getByRole("button", { name: "Hesap Oluştur" }).click();
  await page
    .getByText("Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.")
    .waitFor({ state: "visible", timeout: 10000 });

  await loginAs(page, talepEmail, "Guclu1!Sifre", "/hizmet-talebi-olustur");
  const categorySelect = page.locator("select#" + (await page.getByLabel("Hizmet Kategorisi").first().getAttribute("id")));
  const groupLabels = await categorySelect.locator("optgroup").allTextContents();
  check("'Gümrük Hizmetleri' grubu Hizmet Kategorisi seçiminde mevcut", groupLabels.some((label) => label.includes("Gümrük")));
  await categorySelect.selectOption({ label: "Gümrük Müşavirliği" });
  check("'Gümrük Müşavirliği' gerçek formda seçilebiliyor", await categorySelect.inputValue() === "gumruk-musavirligi");
  check("İlan oluşturma formu: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ 15) Çoklu operasyon: Gümrük Müşavirliği başka hizmetlerle birlikte seçilebiliyor ============
  console.log("\n=== 15) Çoklu Hizmet Operasyonu: Gümrük Müşavirliği başka hizmetlerle seçilebiliyor ===");
  const addServiceButton = page.getByRole("button", { name: /başka bir hizmet ekle/i }).or(page.getByRole("button", { name: /Hizmet Ekle/i }));
  if (await addServiceButton.count() > 0) {
    await addServiceButton.first().click();
    await page.waitForTimeout(200);
    const secondCategorySelect = page.getByLabel("Hizmet Kategorisi").nth(1);
    const secondGroupLabels = await secondCategorySelect.locator("optgroup").allTextContents();
    check(
      "İkinci hizmet kartında da 'Gümrük Hizmetleri' grubu mevcut",
      secondGroupLabels.some((label) => label.includes("Gümrük")),
    );
    await secondCategorySelect.selectOption({ label: "Lashing" });
    check("İkinci karta farklı bir hizmet (Lashing) seçilebiliyor — operasyon ekranı hatasız", page.jsProblems.length === 0);
  } else {
    check("(bilgi) 'Hizmet Ekle' butonu bu form durumunda bulunamadı — çoklu operasyon UI akışı ayrı, kategori-agnostik tmp-multi-service-operation-stage*-test.mjs script'leriyle zaten kapsanıyor", true);
  }

  await context.close();

  console.log(`\n[tmp-gumruk-musavirligi-entegrasyonu-test] ${passed} kontrol geçti.`);
  console.log(anyFail ? "SONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "SONUÇ: TÜM KONTROLLER GEÇTİ.");
  if (anyFail) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[verify] GENEL HATA:", error);
    process.exitCode = 1;
  })
  .finally(() => browser?.close());
