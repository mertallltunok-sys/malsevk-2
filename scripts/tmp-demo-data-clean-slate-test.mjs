// Demo hesaplara ait ilan/teklif/değerlendirme verilerinin kaldırılmasını
// doğrular (app/_lib/reset-demo-data.ts, DEMO_DATA_RESET_VERSION v2 -> v3).
// Bu görevden önce yalnızca ilan/teklif/bildirim-okunma temizleniyordu;
// artık Rating kayıtları da temizleniyor VE version bump, v2'yi zaten
// tamamlamış (ama o tarihten SONRA yeni demo veri birikmiş) bir tarayıcıda
// bile temizliği bir kez daha tetikliyor. Kapsam:
//  - Demo ilan/teklif/rating (hem demo ilana bağlı hem demo Hizmet Veren'e
//    ait) tamamen kalkıyor.
//  - Gerçek kullanıcı verileri (ilan/teklif/rating, demo Hizmet Veren'in
//    GERÇEK bir ilana verdiği teklif hariç) DOKUNULMADAN kalıyor.
//  - Demo hesapların kendisi (giriş bilgileri, ProviderProfile) KORUNUYOR.
//  - Temizlik sonrası her iki rol için de panel görünümü tertemiz.
//  - "Yalnızca bir kez" garantisi v3 altında da geçerli.
// Ön koşul: `npm run dev` (http://localhost:3000).
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const STAMP = Date.now();
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
async function logout(page) {
  await page.goto(`${BASE_URL}/panel`);
  await page.getByRole("button", { name: /Hizmet (Alan|Veren)/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış Yap" }).click();
  await page.waitForURL(`${BASE_URL}/`);
}
// Bu iki hesabın kendisiyle GİRİŞ YAPMIYORUZ -- yalnızca "demo olmayan,
// gerçek kullanıcı" temsilcisi olarak jobId/providerId'lerinde kullanılacak
// bir StoredUser kaydına ihtiyaç var (reset-demo-data.ts kullanıcı listesini
// DEV_ACCOUNT_EMAILS'e göre süzer, id'ye göre değil). Kayıt formu artık
// çok adımlı (ad/soyad, firma, il/ilçe, KVKK/şartlar onayı) olduğu için asıl
// kayıt akışını UI üzerinden sürmek yerine doğrudan localStorage'a StoredUser
// çekirdek alanlarıyla (id/name/email/phone/passwordHash/role) yazıyoruz --
// passwordHash gerçek değil çünkü bu hesaplarla hiç giriş yapılmıyor.
function seedRealUser(page, { id, name, email, phone, role }) {
  return page.evaluate(
    ({ id, name, email, phone, role }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      users.push({ id, name, email, phone, passwordHash: "not-used-in-this-test", role });
      localStorage.setItem("malsevk.users.v1", JSON.stringify(users));
    },
    { id, name, email, phone, role },
  );
}
async function getUserId(page, email) {
  return page.evaluate((targetEmail) => {
    const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
    return users.find((u) => u.email === targetEmail)?.id;
  }, email);
}

function seedJob(page, { id, title, requesterId }) {
  return page.evaluate(
    ({ id, title, requesterId }) => {
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]");
      jobs.push({
        id,
        title,
        category: "Depolama",
        province: "Kocaeli",
        district: "Gebze",
        workLocationType: "Test Tesis",
        workDate: "2026-12-01",
        description: "Temiz başlangıç testi için oluşturulan ilan.",
        operationDetails: "Test operasyon detayı.",
        status: "yayinda",
        requesterId,
        photos: [],
      });
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
    },
    { id, title, requesterId },
  );
}

function seedCompletedOfferWithRating(page, { offerId, jobId, providerId, raterId, stars }) {
  return page.evaluate(
    ({ offerId, jobId, providerId, raterId, stars }) => {
      const now = new Date().toISOString();
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]");
      offers.push({
        id: offerId,
        jobId,
        providerId,
        amount: 5000,
        currency: "TRY",
        description: "Temiz başlangıç testi için oluşturulan tamamlanmış teklif metni.",
        estimatedDuration: "2 gün",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));

      const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]");
      ratings.push({
        id: `rating-${offerId}`,
        offerId,
        jobId,
        providerId,
        raterId,
        stars,
        createdAt: now,
      });
      localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
    },
    { offerId, jobId, providerId, raterId, stars },
  );
}

function setProviderProfile(page, { email, companyName, bio, regions }) {
  return page.evaluate(
    ({ email, companyName, bio, regions }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const next = users.map((u) =>
        u.email === email
          ? { ...u, providerProfile: { companyName, bio, regions, expertise: [] } }
          : u,
      );
      localStorage.setItem("malsevk.users.v1", JSON.stringify(next));
    },
    { email, companyName, bio, regions },
  );
}

const ZEYNEP = { email: "zeynep@test.com", password: "Zeynep1!" };
const MERT = { email: "mert@test.com", password: "Mert123!" };
const MEHMET = { email: "mehmet.demir.demo@malsevk.com", password: "Demo123!" };

const REAL_ALAN = {
  name: "Elif Gerçek",
  email: `elif.gercek.${STAMP}@test.com`,
  phone: "0555 800 80 01",
  password: "ElifGercek1!",
  role: "hizmet-alan",
};
const REAL_VEREN = {
  name: "Ahmet Gerçek",
  email: `ahmet.gercek.${STAMP}@test.com`,
  phone: "0555 800 80 02",
  password: "AhmetGercek1!",
  role: "hizmet-veren",
};

const REAL_JOB_ID = `clean-slate-real-job-${STAMP}`; // gerçek Alan'ın ilanı, demo Hizmet Veren (Mert) kazanmış
const REAL_JOB_TITLE = `TEMIZ-BASLANGIC-GERCEK-ILAN-${STAMP}`;
const PURE_REAL_JOB_ID = `clean-slate-pure-real-job-${STAMP}`; // uçtan uca gerçek, demo ile hiç teması yok
const PURE_REAL_JOB_TITLE = `TEMIZ-BASLANGIC-SAF-GERCEK-${STAMP}`;
const DEMO_JOB_ID = `clean-slate-demo-job-${STAMP}`; // Zeynep'in (demo) ilanı, demo Hizmet Veren (Mehmet) kazanmış
const DEMO_JOB_TITLE = `TEMIZ-BASLANGIC-DEMO-ILAN-${STAMP}`;
const SECOND_DEMO_JOB_ID = `clean-slate-second-demo-job-${STAMP}`;

let browser;

async function main() {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  console.log("\n=== Kurulum: gerçek kullanıcılar + karışık demo/gerçek veri ===");
  await page.goto(BASE_URL);
  const realAlanId = `real-alan-${STAMP}`;
  const realVerenId = `real-veren-${STAMP}`;
  await seedRealUser(page, { id: realAlanId, name: REAL_ALAN.name, email: REAL_ALAN.email, phone: REAL_ALAN.phone, role: REAL_ALAN.role });
  await seedRealUser(page, { id: realVerenId, name: REAL_VEREN.name, email: REAL_VEREN.email, phone: REAL_VEREN.phone, role: REAL_VEREN.role });

  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  const zeynepId = await getUserId(page, ZEYNEP.email);
  await logout(page);
  await loginAs(page, MERT.email, MERT.password);
  const mertId = await getUserId(page, MERT.email);
  await logout(page);
  await loginAs(page, MEHMET.email, MEHMET.password);
  const mehmetId = await getUserId(page, MEHMET.email);
  await logout(page);

  // 1) Saf gerçek: gerçek Alan + gerçek Veren, demo ile hiç teması yok -> HİÇ DOKUNULMAMALI.
  await seedJob(page, { id: PURE_REAL_JOB_ID, title: PURE_REAL_JOB_TITLE, requesterId: realAlanId });
  await seedCompletedOfferWithRating(page, {
    offerId: `offer-pure-real-${STAMP}`,
    jobId: PURE_REAL_JOB_ID,
    providerId: realVerenId,
    raterId: realAlanId,
    stars: 5,
  });
  // 2) Gerçek Alan'ın ilanı, ama demo Hizmet Veren (Mert) kazanmış -> ilan KALIR, bu TEK teklif+rating SİLİNMELİ.
  await seedJob(page, { id: REAL_JOB_ID, title: REAL_JOB_TITLE, requesterId: realAlanId });
  await seedCompletedOfferWithRating(page, {
    offerId: `offer-real-job-demo-provider-${STAMP}`,
    jobId: REAL_JOB_ID,
    providerId: mertId,
    raterId: realAlanId,
    stars: 4,
  });
  // 3) Demo Alan'ın (Zeynep) ilanı, demo Hizmet Veren (Mehmet) kazanmış -> ilan+teklif+rating TAMAMEN SİLİNMELİ.
  await seedJob(page, { id: DEMO_JOB_ID, title: DEMO_JOB_TITLE, requesterId: zeynepId });
  await seedCompletedOfferWithRating(page, {
    offerId: `offer-demo-job-${STAMP}`,
    jobId: DEMO_JOB_ID,
    providerId: mehmetId,
    raterId: zeynepId,
    stars: 3,
  });
  // Requirement 6: profil verisi (ProviderProfile) korunmalı.
  await setProviderProfile(page, {
    email: MERT.email,
    companyName: "Test Lojistik A.Ş.",
    bio: "Bu firma profili, temiz başlangıç testinin profil korunuyor mu kontrolü için oluşturulmuştur ve elli karakterden uzundur.",
    regions: ["Kocaeli"],
  });
  ok("Kurulum: saf gerçek + karışık gerçek/demo + saf demo ilan/teklif/rating oluşturuldu, Mert'e profil eklendi");

  // v2'yi zaten tamamlamış ama SONRASINDA yeni demo veri birikmiş bir
  // tarayıcıyı simüle et (bkz. reset-demo-data.ts version bump notu).
  await page.evaluate(() => localStorage.setItem("malsevk.demo_data_reset_version", "demo-data-reset-v2"));
  const flagBefore = await page.evaluate(() => localStorage.getItem("malsevk.demo_data_reset_version"));
  assert.equal(flagBefore, "demo-data-reset-v2", "Ön koşul: bayrak eski v2 olarak ayarlanmış olmalı");
  ok("[Ön koşul] Migration bayrağı 'demo-data-reset-v2' olarak ayarlandı (v2 tamamlanmış ama sonrasında yeni demo veri birikmiş tarayıcı simülasyonu)");

  // === Otomatik tetikleme: yalnızca ana sayfa ziyareti ===
  console.log("\n=== Otomatik temizlik tetikleniyor (yalnızca ana sayfa ziyareti) ===");
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(1000);

  const flagAfter = await page.evaluate(() => localStorage.getItem("malsevk.demo_data_reset_version"));
  assert.equal(flagAfter, "demo-data-reset-v3", "Ana sayfa ziyareti sonrası bayrak v3'e yükselmeli");
  ok("[Otomatik tetikleme] Migration bayrağı 'demo-data-reset-v3'e yükseltildi");

  const jobsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
  const offersAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]"));
  const ratingsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]"));

  assert.ok(!jobsAfter.some((j) => j.id === DEMO_JOB_ID), "Demo ilan silinmeli");
  assert.equal(offersAfter.filter((o) => o.jobId === DEMO_JOB_ID).length, 0, "Demo ilana bağlı teklif kalmamalı");
  assert.equal(ratingsAfter.filter((r) => r.jobId === DEMO_JOB_ID).length, 0, "Demo ilana bağlı rating kalmamalı");
  ok("[Silindi] Demo ilan (Zeynep) + bağlı teklif + rating tamamen kalktı");

  assert.ok(jobsAfter.some((j) => j.id === REAL_JOB_ID), "Gerçek Alan'ın ilanı SİLİNMEMELİ");
  assert.equal(
    offersAfter.filter((o) => o.jobId === REAL_JOB_ID).length,
    0,
    "Gerçek ilana demo Hizmet Veren'in verdiği teklif silinmeli (ilanın kendisi kalsa da)",
  );
  assert.equal(
    ratingsAfter.filter((r) => r.jobId === REAL_JOB_ID).length,
    0,
    "Demo Hizmet Veren'e verilen rating de silinmeli",
  );
  ok("[Kısmi silme] Gerçek ilan korundu, yalnızca demo Hizmet Veren'in teklifi+rating'i kalktı");

  assert.ok(jobsAfter.some((j) => j.id === PURE_REAL_JOB_ID), "Saf gerçek ilan SİLİNMEMELİ");
  assert.equal(
    offersAfter.filter((o) => o.jobId === PURE_REAL_JOB_ID).length,
    1,
    "Saf gerçek teklif SİLİNMEMELİ",
  );
  assert.equal(
    ratingsAfter.filter((r) => r.jobId === PURE_REAL_JOB_ID).length,
    1,
    "Saf gerçek rating SİLİNMEMELİ",
  );
  ok("[Dokunulmadı] Demo ile hiç teması olmayan gerçek ilan/teklif/rating tamamen korundu");

  const usersAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]"));
  const mertAfter = usersAfter.find((u) => u.email === MERT.email);
  assert.ok(mertAfter, "Mert kullanıcı kaydı SİLİNMEMELİ");
  assert.equal(mertAfter.providerProfile?.companyName, "Test Lojistik A.Ş.", "Mert'in ProviderProfile'ı korunmalı");
  ok("[Hesap korundu] Mert'in kullanıcı kaydı VE ProviderProfile'ı hiç değişmedi");

  // === Demo hesaplar hâlâ aynı bilgilerle giriş yapabiliyor, temiz başlangıç ===
  console.log("\n=== Demo hesaplar: aynı giriş bilgileri + tertemiz panel ===");
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  ok("[Giriş] Zeynep hâlâ aynı şifreyle giriş yapabiliyor");
  await page.goto(`${BASE_URL}/panel/hizmet-taleplerim`);
  await assert.doesNotReject(
    page.getByText("Henüz aktif bir hizmet talebiniz bulunmuyor.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Temiz başlangıç] Zeynep: Hizmet Taleplerim'de hiç ilan yok");
  await page.goto(`${BASE_URL}/panel/gelen-teklifler`);
  const gelenTekliflerBody = await page.locator("main").innerText();
  assert.ok(
    !gelenTekliflerBody.includes(DEMO_JOB_TITLE) && !gelenTekliflerBody.includes(REAL_JOB_TITLE),
    "Gelen Teklifler'de eski demo ilanlara ait hiçbir teklif görünmemeli",
  );
  ok("[Temiz başlangıç] Zeynep: Gelen Teklifler'de eski veriye ait hiçbir şey yok");
  await logout(page);

  await loginAs(page, MERT.email, MERT.password);
  ok("[Giriş] Mert hâlâ aynı şifreyle giriş yapabiliyor");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  const tablist = page.getByRole("tablist", { name: "Teklif durumu" });
  await tablist.waitFor({ state: "visible", timeout: 10000 });
  const tabTexts = await tablist.getByRole("tab").allInnerTexts();
  for (const tabName of ["Aktif", "Devam Eden", "Tamamlanan", "Kapanan Teklifler"]) {
    if (tabName !== "Aktif") {
      await page.getByRole("tab", { name: tabName }).click();
      await page.waitForTimeout(200);
    }
    const body = await page.locator("main").innerText();
    assert.ok(
      !body.includes(REAL_JOB_TITLE) && !body.includes(DEMO_JOB_TITLE) && !body.includes(PURE_REAL_JOB_TITLE),
      `Mert: '${tabName}' sekmesinde eski/başkasına ait hiçbir teklif görünmemeli`,
    );
  }
  assert.equal(tabTexts.length, 4, "4 sekme render edilmeli");
  ok("[Temiz başlangıç] Mert: Verdiğim Teklifler'in 4 sekmesi de (Aktif/Devam Eden/Tamamlanan/Kapanan Teklifler) tertemiz");
  await logout(page);

  await loginAs(page, MEHMET.email, MEHMET.password);
  ok("[Giriş] Mehmet Demir hâlâ aynı şifreyle giriş yapabiliyor");
  await page.goto(`${BASE_URL}/panel/tekliflerim`);
  await assert.doesNotReject(
    page.getByText("Henüz herhangi bir ilana teklif vermediniz.").waitFor({ state: "visible", timeout: 10000 }),
  );
  ok("[Temiz başlangıç] Mehmet Demir: Verdiğim Teklifler boş");
  await logout(page);

  // === "Yalnızca bir kez" garantisi v3 altında da geçerli ===
  console.log("\n=== Tek seferlik garanti (v3) ===");
  await loginAs(page, ZEYNEP.email, ZEYNEP.password);
  const zeynepId2 = await getUserId(page, ZEYNEP.email);
  await seedJob(page, { id: SECOND_DEMO_JOB_ID, title: `IKINCI-ZIYARET-${STAMP}`, requesterId: zeynepId2 });
  await logout(page);

  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(600);
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(600);

  const jobsAfterSecondVisit = await page.evaluate(() => JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]"));
  assert.ok(
    jobsAfterSecondVisit.some((j) => j.id === SECOND_DEMO_JOB_ID),
    "Migration zaten v3'ü tamamladığı için sonraki ziyaretler yeni oluşturulan (test amaçlı) ilana dokunmamalı",
  );
  ok("[Tek seferlik garanti] v3 bayrağı set edildikten sonraki ziyaretler veriyi tekrar silmiyor");

  if (consoleErrors.length > 0) {
    console.log("\n[demo-data-clean-slate-test] UYARI: Konsolda hata yakalandı:");
    for (const err of consoleErrors) console.log(`  ! ${err}`);
  } else {
    console.log("\n[demo-data-clean-slate-test] Konsolda hiç JS hatası yakalanmadı.");
  }

  // Temizlik: bu testin kendi kalıntıları (gerçek hesaplar + saf gerçek ilan, ikinci demo ilan).
  await page.evaluate(
    ({ realEmails, jobIds }) => {
      const users = JSON.parse(localStorage.getItem("malsevk.users.v1") || "[]");
      const removedIds = users.filter((u) => realEmails.includes(u.email)).map((u) => u.id);
      localStorage.setItem("malsevk.users.v1", JSON.stringify(users.filter((u) => !removedIds.includes(u.id))));
      const jobs = JSON.parse(localStorage.getItem("malsevk.jobs.v1") || "[]").filter((j) => !jobIds.includes(j.id));
      localStorage.setItem("malsevk.jobs.v1", JSON.stringify(jobs));
      const offers = JSON.parse(localStorage.getItem("malsevk.offers.v1") || "[]").filter((o) => !jobIds.includes(o.jobId));
      localStorage.setItem("malsevk.offers.v1", JSON.stringify(offers));
      const ratings = JSON.parse(localStorage.getItem("malsevk.ratings.v1") || "[]").filter((r) => !jobIds.includes(r.jobId));
      localStorage.setItem("malsevk.ratings.v1", JSON.stringify(ratings));
    },
    { realEmails: [REAL_ALAN.email, REAL_VEREN.email], jobIds: [PURE_REAL_JOB_ID, REAL_JOB_ID, SECOND_DEMO_JOB_ID] },
  );

  await browser.close();
  console.log(`\n[demo-data-clean-slate-test] ${passed} test geçti.`);
}

main()
  .catch((error) => {
    console.error("[demo-data-clean-slate-test] HATA:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
  });
