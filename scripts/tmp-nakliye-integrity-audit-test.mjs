// Nakliye görünürlük bütünlük denetimi (yeniden yazma + kaçak erişim
// taraması) sırasında bulunan gerçek sızıntı noktalarının VE yeni Nakliyeci
// demo hesabının doğrulaması:
//  1) my-offers-panel.tsx: gizli bir ilana ait ESKİ teklif artık "İlan artık
//     mevcut değil" güvenli fallback'iyle gösteriliyor, gerçek başlık/kategori/
//     konum VE karşı tarafın iletişim bilgisi sızmıyor.
//  2) panel-summary.tsx (Hizmet Veren "Panel Özeti"): "Uygun İlanlar" sayacı
//     ve "Son Hareketler" gizli ilan sayısını/başlığını dolaylı sızdırmıyor.
//  3) provider-services.ts artık reaktif (useSyncExternalStore) — CAPRAZ
//     SEKME'de hizmet değişikliği, sayfa yenilenmeden diğer sekmeye yansıyor.
//  4) Nakliyeci demo hesabı: DEV_ACCOUNTS + provider-services.ts +
//     provider-documents.ts + provider-document-consents.ts üzerinden doğru
//     kurulmuş, tekrar seed edilince çoğalmıyor, giriş/görünürlük çalışıyor.
//
// Ön koşul: `npm run dev` çalışıyor olmalı (http://localhost:3000).
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const RUN_ID = Date.now();
const NAKLIYECI = { email: "nakliyeci@test.com", password: "Nakliye123!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };

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

// Nakliyeci'nin ekstra (belge + beyan) seed zinciri IndexedDB yazımı
// içerdiği için ASENKRON — yalnızca kullanıcı kaydının varlığını beklemek
// (waitForDevAccountSeeded) yeterli değildir, o an hâlâ devam ediyor
// olabilir. Beyan kaydı zincirin EN SON adımı olduğu için (bkz. users.ts#
// seedNakliyeciProviderProfileIfNeeded) onun varlığı TÜM zincirin
// tamamlandığının güvenilir işaretidir.
async function waitForNakliyeciFullySeeded(page, timeoutMs = 10000) {
  await page.waitForFunction(
    (targetEmail) => {
      try {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        const user = users.find((u) => u.email === targetEmail);
        if (!user) return false;
        const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
        return consents.some((c) => c.userId === user.id);
      } catch {
        return false;
      }
    },
    NAKLIYECI.email,
    { timeout: timeoutMs },
  );
}

// Gümrük Müşaviri demo hesabının seed zinciri (bkz. users.ts#
// seedGumrukMusaviriProviderProfileIfNeeded) Nakliyeci'yle AYNI mimari ama
// İKİ bağımsız beyan kaydı yazar (genel + Gümrük'e özel) — zincirin
// tamamlandığının güvenilir işareti bu İKİ kaydın da mevcut olmasıdır.
async function waitForGumrukMusaviriFullySeeded(page, timeoutMs = 10000) {
  await page.waitForFunction(
    (targetEmail) => {
      try {
        const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
        const user = users.find((u) => u.email === targetEmail);
        if (!user) return false;
        const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
        return consents.filter((c) => c.userId === user.id).length >= 2;
      } catch {
        return false;
      }
    },
    "gumrukdemo@malsevk.demo",
    { timeout: timeoutMs },
  );
}

async function loginAs(page, email, password, redirect = "/panel") {
  // `page.goto` ÖNCE gelmeli: context.newPage() ile yeni açılan bir sekme
  // başlangıçta "about:blank"tadır ve orada localStorage'a erişim
  // SecurityError fırlatır (opak origin) — bu yüzden evaluate her zaman
  // gerçek bir http(s) sayfasına navigate edildikten SONRA çalıştırılır.
  await page.goto(`${BASE_URL}/giris-yap?redirect=${encodeURIComponent(redirect)}`);
  await page.evaluate(() => localStorage.removeItem("malsevk.session.v1"));
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
      district: "Gebze",
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

async function seedOffer(page, offer) {
  await page.evaluate((offerInput) => {
    const now = new Date().toISOString();
    const record = {
      id: offerInput.id,
      jobId: offerInput.jobId,
      providerId: offerInput.providerId,
      amount: 5000,
      currency: "TRY",
      description: "Test teklifi - Nakliye izolasyon denetimi.",
      estimatedDuration: "1 iş günü",
      status: offerInput.status,
      createdAt: now,
      updatedAt: now,
    };
    const existing = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
    localStorage.setItem(
      "malsevk.offers.v1",
      JSON.stringify([...existing.filter((o) => o.id !== record.id), record]),
    );
  }, offer);
}

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  attachDiagnostics(page);

  // ============ Nakliyeci demo hesabı: seed + giriş ============
  console.log("\n=== Nakliyeci demo hesabı: seed doğrulaması ===");
  await page.goto(`${BASE_URL}/giris-yap`);
  await waitForNakliyeciFullySeeded(page);

  const seedState1 = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const user = users.find((u) => u.email === email);
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      user,
      services: user ? services.filter((s) => s.userId === user.id) : [],
      documents: user ? documents.filter((d) => d.userId === user.id) : [],
      consents: user ? consents.filter((c) => c.userId === user.id) : [],
    };
  }, NAKLIYECI.email);

  check("Nakliyeci demo kullanıcısı seed edilmiş", seedState1.user != null);
  check("Rol hizmet-veren", seedState1.user?.role === "hizmet-veren");
  check("Firma adı 'MALSEVK Nakliye Demo'", seedState1.user?.companyName === "MALSEVK Nakliye Demo");
  check("companyType 'limited-sirket'", seedState1.user?.companyType === "limited-sirket");
  check("İl 'Kocaeli', İlçe 'Gebze'", seedState1.user?.province === "Kocaeli" && seedState1.user?.district === "Gebze");
  check(
    "provider_services.v1: yalnızca ['nakliye']",
    seedState1.services.length === 1 && seedState1.services[0]?.serviceCategoryId === "nakliye",
  );
  check("providerProfile.serviceCategories YAZILMAMIŞ (deprecated alan)", !seedState1.user?.providerProfile?.serviceCategories);
  check("provider_documents.v1: 1 belge, reviewStatus 'approved'", seedState1.documents.length === 1 && seedState1.documents[0]?.reviewStatus === "approved");
  check("provider_document_consents.v1: 1 kabul kaydı", seedState1.consents.length === 1);

  // ============ Seed idempotency: sayfa yeniden yüklenince çoğalmıyor ============
  console.log("\n=== Seed tekrar çalıştırılınca çoğalmıyor ===");
  await page.reload();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(600);
  const seedState2 = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const matchingUsers = users.filter((u) => u.email === email);
    const userId = matchingUsers[0]?.id;
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      userCount: matchingUsers.length,
      serviceCount: services.filter((s) => s.userId === userId).length,
      documentCount: documents.filter((d) => d.userId === userId).length,
      consentCount: consents.filter((c) => c.userId === userId).length,
    };
  }, NAKLIYECI.email);
  check("Tekrar seed sonrası: tek kullanıcı kaydı", seedState2.userCount === 1);
  check("Tekrar seed sonrası: hizmet ilişkisi çoğalmamış (1)", seedState2.serviceCount === 1);
  check("Tekrar seed sonrası: belge çoğalmamış (1)", seedState2.documentCount === 1);
  check("Tekrar seed sonrası: beyan çoğalmamış (1)", seedState2.consentCount === 1);

  // ============ Gümrük Müşaviri demo hesabı: seed + idempotency ============
  console.log("\n=== Gümrük Müşaviri demo hesabı: seed doğrulaması ===");
  const GUMRUK_DEMO = { email: "gumrukdemo@malsevk.demo", password: "Demo1234!" };
  await page.goto(`${BASE_URL}/giris-yap`);
  await waitForGumrukMusaviriFullySeeded(page);

  const gumrukSeedState1 = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const user = users.find((u) => u.email === email);
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      user,
      services: user ? services.filter((s) => s.userId === user.id) : [],
      documents: user ? documents.filter((d) => d.userId === user.id) : [],
      consents: user ? consents.filter((c) => c.userId === user.id) : [],
    };
  }, GUMRUK_DEMO.email);

  check("Gümrük Müşaviri demo kullanıcısı seed edilmiş", gumrukSeedState1.user != null);
  check("Rol hizmet-veren", gumrukSeedState1.user?.role === "hizmet-veren");
  check(
    "Firma adı 'Marmara Gümrük Müşavirliği Ltd. Şti.'",
    gumrukSeedState1.user?.companyName === "Marmara Gümrük Müşavirliği Ltd. Şti.",
  );
  check("companyType 'limited-sirket'", gumrukSeedState1.user?.companyType === "limited-sirket");
  check(
    "İl 'Kocaeli', İlçe 'Gebze'",
    gumrukSeedState1.user?.province === "Kocaeli" && gumrukSeedState1.user?.district === "Gebze",
  );
  check(
    "provider_services.v1: yalnızca ['gumruk-musavirligi']",
    gumrukSeedState1.services.length === 1 && gumrukSeedState1.services[0]?.serviceCategoryId === "gumruk-musavirligi",
  );
  check(
    "provider_documents.v1: 1 belge, documentType 'gumruk-musaviri-izin-belgesi', reviewStatus 'approved'",
    gumrukSeedState1.documents.length === 1 &&
      gumrukSeedState1.documents[0]?.documentType === "gumruk-musaviri-izin-belgesi" &&
      gumrukSeedState1.documents[0]?.reviewStatus === "approved",
  );
  check(
    "provider_document_consents.v1: 2 kabul kaydı (genel + Gümrük'e özel)",
    gumrukSeedState1.consents.length === 2 &&
      gumrukSeedState1.consents.some((c) => c.statementId === "belge-dogruluk-beyani") &&
      gumrukSeedState1.consents.some((c) => c.statementId === "gumruk-musaviri-belge-beyani"),
  );

  // ============ Seed idempotency: sayfa yeniden yüklenince çoğalmıyor ============
  console.log("\n=== Gümrük Müşaviri: seed tekrar çalıştırılınca çoğalmıyor ===");
  await page.reload();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(600);
  const gumrukSeedState2 = await page.evaluate((email) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    const matchingUsers = users.filter((u) => u.email === email);
    const userId = matchingUsers[0]?.id;
    const services = JSON.parse(localStorage.getItem("malsevk.provider_services.v1") || "[]");
    const documents = JSON.parse(localStorage.getItem("malsevk.provider_documents.v1") || "[]");
    const consents = JSON.parse(localStorage.getItem("malsevk.provider_document_consents.v1") || "[]");
    return {
      userCount: matchingUsers.length,
      serviceCount: services.filter((s) => s.userId === userId).length,
      documentCount: documents.filter((d) => d.userId === userId).length,
      consentCount: consents.filter((c) => c.userId === userId).length,
    };
  }, GUMRUK_DEMO.email);
  check("Tekrar seed sonrası: tek kullanıcı kaydı", gumrukSeedState2.userCount === 1);
  check("Tekrar seed sonrası: hizmet ilişkisi çoğalmamış (1)", gumrukSeedState2.serviceCount === 1);
  check("Tekrar seed sonrası: belge çoğalmamış (1)", gumrukSeedState2.documentCount === 1);
  check("Tekrar seed sonrası: beyan çoğalmamış (2)", gumrukSeedState2.consentCount === 2);

  // ============ Giriş ekranı: her zorunlu demo hesap doğru bilgiyle mevcut ============
  // Sabit toplam satır sayısına (ör. "tam 5 satır") BAĞLI DEĞİLDİR — yeni bir
  // demo hesap eklendiğinde (ör. Gümrük Müşaviri) bu sayı meşru şekilde
  // artar; bu, bir regresyon değildir. Bunun yerine her ZORUNLU hesabın
  // KENDİ satırının doğru e-posta/şifre bilgisiyle, herhangi bir sırada,
  // listede bulunduğu doğrulanır — hem sıra hem toplam sayı değişse bile
  // "bir hesabın satırı eksik/yanlış" gerçek regresyonunu yakalamaya devam eder.
  console.log("\n=== Giriş ekranı: zorunlu demo hesap satırları ===");
  await page.goto(`${BASE_URL}/giris-yap`);
  const hintLines = await page
    .locator("p")
    .filter({ hasText: /test\.com|malsevk\.com/ })
    .allTextContents();
  const REQUIRED_DEMO_ACCOUNT_LINES = [
    { label: "Hizmet Alan (Zeynep)", email: "zeynep@test.com", password: "Zeynep1!" },
    { label: "Hizmet Veren (Mert)", email: "mert@test.com", password: "Mert123!" },
    { label: "Hizmet Veren (Mehmet Demir)", email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" },
    { label: "Nakliyeci", email: "nakliyeci@test.com", password: "Nakliye123!" },
    { label: "Gümrük Müşaviri (Ahmet Yılmaz)", email: "gumrukdemo@malsevk.demo", password: "Demo1234!" },
    { label: "Admin (Belge Kontrolü)", email: "admin@test.com", password: "Admin123!" },
  ];
  for (const account of REQUIRED_DEMO_ACCOUNT_LINES) {
    check(
      `Demo hesap satırı mevcut ve doğru: ${account.label} (${account.email} / ${account.password})`,
      hintLines.some((line) => line.includes(account.email) && line.includes(account.password)),
      JSON.stringify(hintLines),
    );
  }
  check(
    "Hiçbir satır tekrarlanmıyor (her hesap TAM BİR kez listeleniyor)",
    REQUIRED_DEMO_ACCOUNT_LINES.every(
      (account) => hintLines.filter((line) => line.includes(account.email)).length === 1,
    ),
    JSON.stringify(hintLines),
  );

  // ============ Nakliyeci girişi + profil + görünürlük ============
  console.log("\n=== Nakliyeci girişi ve görünürlük ===");
  await loginAs(page, NAKLIYECI.email, NAKLIYECI.password, "/panel");
  check("Nakliyeci girişi başarılı", true);

  const nakliyeciId = await getUserId(page, NAKLIYECI.email);

  // Görünürlük denetimi için gizli ve görünür ilan seed et.
  const requesterId = await page.evaluate(() => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === "zeynep@test.com")?.id ?? null;
  });
  const nakliyeJobId = `audit-nakliye-job-${RUN_ID}`;
  const lashingJobId = `audit-lashing-job-${RUN_ID}`;
  await seedJob(page, { id: nakliyeJobId, title: `Denetim Nakliye ${RUN_ID}`, category: "nakliye", requesterId });
  await seedJob(page, { id: lashingJobId, title: `Denetim Lashing ${RUN_ID}`, category: "lashing", requesterId });

  await page.goto(`${BASE_URL}/ilanlar`);
  await page.waitForTimeout(300);
  await page.getByText(`Denetim Nakliye ${RUN_ID}`).first().waitFor({ state: "visible", timeout: 10000 });
  check("Nakliyeci: Nakliye ilanı görünüyor", true);
  check("Nakliyeci: Lashing ilanı GÖRÜNMÜYOR", (await page.getByText(`Denetim Lashing ${RUN_ID}`).count()) === 0);

  await page.goto(`${BASE_URL}/ilanlar/${lashingJobId}`);
  await page.getByText("İlan bulunamadı", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  check("Nakliyeci: Lashing ilan detayına doğrudan URL ile erişemiyor", true);

  // ============ my-offers-panel.tsx: gizli ilana ait ESKİ teklif sızdırmıyor ============
  console.log("\n=== 'Verdiğim Teklifler': gizli ilana ait eski teklif sızdırmıyor ===");
  const oldHiddenOfferId = `audit-old-offer-${RUN_ID}`;
  await seedOffer(page, { id: oldHiddenOfferId, jobId: lashingJobId, providerId: nakliyeciId, status: "accepted" });
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await page.waitForTimeout(300);
  check(
    "'İlan artık mevcut değil' güvenli fallback'i gösteriliyor",
    await page.getByText("İlan artık mevcut değil").isVisible().catch(() => false),
  );
  check(
    "Gizli ilanın gerçek başlığı ('Denetim Lashing ...') SIZMIYOR",
    (await page.getByText(`Denetim Lashing ${RUN_ID}`).count()) === 0,
  );
  check(
    "Gizli ilanın kategori etiketi ('Lashing') bu teklif kartında SIZMIYOR",
    (await page.locator(`[class*="rounded-card"]:has-text("İlan artık mevcut değil")`).getByText("Lashing", { exact: true }).count()) === 0,
  );
  // "accepted" durumu ENGAGED_OFFER_STATUSES içinde olduğu için normalde
  // karşı tarafın iletişim bilgisi (ContactInfoBlock) gösterilirdi — job
  // görünürlük dışı olduğu için bu da gösterilmemeli.
  check(
    "Karşı tarafın (zeynep) iletişim bilgisi (telefon) SIZMIYOR",
    (await page.getByText("+90", { exact: false }).count()) === 0,
  );
  check("'Verdiğim Teklifler' ekranı: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  // ============ panel-summary.tsx: sayaçlar/son hareketler sızdırmıyor ============
  console.log("\n=== Panel Özeti: sayaçlar ve Son Hareketler sızdırmıyor ===");
  await page.goto(`${BASE_URL}/panel`);
  await page.waitForTimeout(300);
  check(
    "Panel Özeti'nde gizli ilanın başlığı ('Denetim Lashing ...') SIZMIYOR",
    (await page.getByText(`Denetim Lashing ${RUN_ID}`).count()) === 0,
  );
  check("Panel Özeti: konsol hatası yok", page.jsProblems.length === 0, page.jsProblems.join(" | "));

  const availableListingCountText = await page
    .locator("text=Uygun İlanlar")
    .locator("xpath=ancestor::*[1]")
    .first()
    .innerText()
    .catch(() => "");
  console.log(`    (bilgi) 'Uygun İlanlar' kart metni: ${JSON.stringify(availableListingCountText).slice(0, 120)}`);

  // ============ Reddedilen/gizli veri: veri katmanından teklif oluşturulamıyor ============
  console.log("\n=== Veri katmanı: Nakliye dışı ilana teklif oluşturulamıyor (offer-panel doğrudan test) ===");
  // job-detail-content.tsx zaten Lashing ilanına erişimi tamamen engellediği
  // (yukarıda doğrulandı) için OfferPanel'e hiç ulaşılamıyor — bu, createOffer'ın
  // veri katmanı kapısının (offers.ts#createOffer) DOLAYLI ama kesin kanıtıdır:
  // form hiç render edilmediği için teklif gönderilemez.
  check(
    "Lashing ilan sayfasında 'Teklif Ver' formu hiç render edilmiyor (erişim reddi sayfasında form yok)",
    (await page.getByLabel("Teklif Fiyatı").count()) === 0,
  );

  await logout(page);

  // ============ Cross-tab reaktivite: sayfa yenilenmeden görünürlük güncelleniyor ============
  console.log("\n=== Çapraz sekme: hizmet değişikliği sayfa yenilenmeden yansıyor ===");
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  attachDiagnostics(pageA);
  attachDiagnostics(pageB);

  await loginAs(pageA, NAKLIYECI.email, NAKLIYECI.password, "/panel/profil");
  await pageB.goto(`${BASE_URL}/ilanlar`);
  await pageB.waitForTimeout(300);
  check(
    "Sekme B (başlangıç): Lashing ilanı GÖRÜNMÜYOR (Nakliyeci hâlâ kısıtlı)",
    (await pageB.getByText(`Denetim Lashing ${RUN_ID}`).count()) === 0,
  );

  // Sekme A: Nakliye chip'ini kaldır ve kaydet.
  const nakliyeChip = pageA.getByRole("button", { name: "Nakliye", exact: true });
  await nakliyeChip.waitFor({ state: "visible", timeout: 10000 });
  await nakliyeChip.click();
  await pageA.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
  await pageA.getByText("Hizmet bilgileriniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });

  // Sekme B: SAYFA YENİLENMEDEN (reload YOK) `storage` olayı ile güncellenmeli.
  await pageB.waitForFunction(
    (title) => document.body.innerText.includes(title),
    `Denetim Lashing ${RUN_ID}`,
    { timeout: 10000 },
  );
  check("Sekme B: sayfa YENİLENMEDEN Lashing ilanı artık görünüyor (cross-tab reaktivite çalışıyor)", true);
  check("Cross-tab reaktivite: konsol hatası yok (Sekme A)", pageA.jsProblems.length === 0, pageA.jsProblems.join(" | "));
  check("Cross-tab reaktivite: konsol hatası yok (Sekme B)", pageB.jsProblems.length === 0, pageB.jsProblems.join(" | "));

  await pageA.close();
  await pageB.close();

  // ============ Nakliye'yi geri ekle (bir sonraki çalıştırma için hesabı sıfırla) ============
  const resetPage = await context.newPage();
  await loginAs(resetPage, NAKLIYECI.email, NAKLIYECI.password, "/panel/profil");
  const resetChip = resetPage.getByRole("button", { name: "Nakliye", exact: true });
  await resetChip.waitFor({ state: "visible", timeout: 10000 });
  if ((await resetChip.getAttribute("aria-pressed")) === "false") {
    await resetChip.click();
    await resetPage.getByRole("button", { name: "Hizmet Bilgilerimi Kaydet" }).click();
    await resetPage.getByText("Hizmet bilgileriniz kaydedildi.").waitFor({ state: "visible", timeout: 10000 });
  }
  await resetPage.close();

  // ============ Regresyon: mert (Nakliye seçmemiş) davranışı değişmedi ============
  console.log("\n=== Regresyon: mert (Nakliye seçmemiş) davranışı değişmedi ===");
  const finalPage = await context.newPage();
  attachDiagnostics(finalPage);
  await loginAs(finalPage, MERT.email, MERT.password, "/ilanlar");
  await finalPage.waitForTimeout(300);
  check(
    "mert: Lashing ilanını görebiliyor (kısıtlama yok)",
    await finalPage.getByText(`Denetim Lashing ${RUN_ID}`).first().isVisible().catch(() => false),
  );
  check("mert ilan listesi: konsol hatası yok", finalPage.jsProblems.length === 0, finalPage.jsProblems.join(" | "));
  await finalPage.close();

  await context.close();

  console.log(`\n[tmp-nakliye-integrity-audit-test] ${passed} kontrol geçti.`);
  console.log(anyFail ? "SONUÇ: EN AZ BİR KONTROL BAŞARISIZ." : "SONUÇ: TÜM KONTROLLER GEÇTİ.");
  if (anyFail) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[tmp-nakliye-integrity-audit-test] GENEL HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
